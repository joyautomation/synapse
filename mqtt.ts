import * as mqtt from "mqtt";
import type {
  ISparkplugEdgeOptions,
  ISparkplugHostOptions,
  SparkplugHost,
  SparkplugNode,
  SparkplugTopic,
} from "./types.d.ts";
import * as sparkplug from "npm:sparkplug-payload@1.0.3";
import { pipe } from "ramda";
import { logs } from "./log.ts";
const { main: log } = logs;
import type {
  UMetric,
  UPayload,
} from "sparkplug-payload/lib/sparkplugbpayload.js";
import {
  compressPayloadCurry as compressPayloadCurry,
  decompressPayload,
} from "./compression/index.ts";
import type { PayloadOptions } from "./compression/types.d.ts";
import { cond } from "./utils.ts";
import type { EventEmitter } from "node:events";
import { Buffer } from "node:buffer";

/**
 * Wrapper function to connect to an MQTT broker
 * @param {string} url - The URL of the MQTT broker
 * @param {mqtt.IClientOptions} options - MQTT client options
 * @returns {mqtt.MqttClient} MQTT client instance
 */
export function mqttConnect(url: string, options: mqtt.IClientOptions) {
  return mqtt.connect(url, options);
}

export const _internals = {
  mqttConnect,
};

/** Sparkplug B protocol version */
const version: string = "spBv1.0";

/** Sparkplug B payload encoder/decoder instance */
const spb = sparkplug.get(version)!;
export const { encodePayload, decodePayload } = spb;

/**
 * Converts a Uint8Array to a Buffer
 * @param {Uint8Array} payload - The payload to convert
 * @returns {Buffer} The converted Buffer
 */
const toBuffer = (payload: Uint8Array) => Buffer.from(payload);

/**
 * Creates a Sparkplug B topic string
 * @param {string} commandType - The Sparkplug B command type
 * @param {ISparkplugEdgeOptions} options - Sparkplug edge configuration options
 * @param {string} [deviceId] - Optional device ID
 * @returns {string} Formatted Sparkplug B topic string
 */
export const createSpbTopic = (
  commandType:
    | "NBIRTH"
    | "NDEATH"
    | "NDATA"
    | "NCMD"
    | "DCMD"
    | "DBIRTH"
    | "DDEATH"
    | "DDATA",
  { version, groupId, edgeNode }: ISparkplugEdgeOptions,
  deviceId?: string,
) =>
  `${version}/${groupId}/${commandType}/${edgeNode}${
    deviceId ? "/" + deviceId : ""
  }`;

/**
 * Creates a payload buffer from a given payload object
 * @param {any} payload - The payload object to encode
 * @returns {Buffer} Encoded payload as a Buffer
 */
export const createPayload = (payload: any) =>
  pipe(encodePayload, toBuffer)(payload);

/**
 * Adds a bdSeq metric to the given payload
 * @param {number} bdSeq - Birth/death sequence number
 * @param {UPayload} payload - The payload to modify
 * @returns {UPayload} Modified payload with bdSeq metric added
 */
export const addBdSeqMetric = (bdSeq: number, payload: UPayload): UPayload => ({
  ...payload,
  metrics: [
    ...(payload.metrics || []),
    {
      name: "bdSeq",
      value: bdSeq,
      type: "UInt64",
    },
  ],
});

/**
 * Creates a curried function to add bdSeq metric to a payload
 * @param {number} bdSeq - Birth/death sequence number
 * @returns {Function} Curried function that takes a payload and returns a modified payload
 */
export const addBdSeqMetricCurry =
  (bdSeq: number) => (payload: UPayload): UPayload =>
    addBdSeqMetric(bdSeq, payload);

/**
 * Adds a sequence number to the given payload
 * @param {SparkplugNode | SparkplugHost} sparkplug - Sparkplug node or host instance
 * @param {UPayload} payload - The payload to modify
 * @returns {UPayload} Modified payload with sequence number added
 */
export const addSeqNumber = (
  sparkplug: SparkplugNode | SparkplugHost,
  payload: UPayload,
): UPayload => {
  if (sparkplug.seq == 256) sparkplug.seq = 0;
  return {
    ...payload,
    seq: sparkplug.seq++ || 0,
  };
};

/**
 * Creates a curried function to add sequence number to a payload
 * @param {SparkplugNode | SparkplugHost} sparkplug - Sparkplug node or host instance
 * @returns {Function} Curried function that takes a payload and returns a modified payload
 */
export const addSeqNumberCurry =
  (sparkplug: SparkplugNode | SparkplugHost) => (payload: UPayload): UPayload =>
    addSeqNumber(sparkplug, payload);

/**
 * Publishes a node death message
 * @param {number} bdSeq - Birth/death sequence number
 * @param {ISparkplugEdgeOptions} mqttConfig - MQTT configuration options
 * @param {mqtt.MqttClient} client - MQTT client instance
 */
export const publishNodeDeath = (
  bdSeq: number,
  mqttConfig: ISparkplugEdgeOptions,
  client: mqtt.MqttClient,
) => {
  const payload = getDeathPayload(bdSeq);
  const topic = createSpbTopic("NDEATH", mqttConfig);
  publish(topic, pipe(encodePayload, toBuffer)(payload), client);
};

/**
 * Publishes a node birth message
 * @param {number} bdSeq - Birth/death sequence number
 * @param {number} seq - Sequence number
 * @param {PayloadOptions | undefined} options - Payload compression options
 * @param {UPayload} payload - The payload to publish
 * @param {ISparkplugEdgeOptions} mqttConfig - MQTT configuration options
 * @param {mqtt.MqttClient} client - MQTT client instance
 */
export const publishNodeBirth = (
  bdSeq: number,
  seq: number,
  options: PayloadOptions | undefined,
  payload: UPayload,
  mqttConfig: ISparkplugEdgeOptions,
  client: mqtt.MqttClient,
) => {
  const topic = createSpbTopic("NBIRTH", mqttConfig);
  publish(
    topic,
    pipe(
      addBdSeqMetricCurry(bdSeq),
      compressPayloadCurry(options),
      encodePayload,
      toBuffer,
    )(payload) as Buffer,
    client,
  );
  log.info(`published node ${mqttConfig.edgeNode} birth`);
};

/**
 * Publishes a payload for a specific Sparkplug command
 * @param {string} command - The Sparkplug command type
 * @returns {Function} A function that publishes the payload for the specified command
 */
const publishPayload =
  (command: "DBIRTH" | "DDEATH" | "DDATA" | "NDATA" | "NCMD" | "DCMD") =>
  (
    sparkplug: SparkplugNode,
    payload: UPayload,
    mqttConfig: ISparkplugEdgeOptions,
    client: mqtt.MqttClient,
    deviceId?: string,
  ) => {
    const topic = createSpbTopic(command, mqttConfig, deviceId);
    if (command === "NDATA") {
      log.debug(`Publishing NDATA on node ${mqttConfig.edgeNode}`);
    } else {
      log.debug(
        `Publishing Device ${deviceId} ${command} on node ${mqttConfig.edgeNode}`,
      );
    }
    publish(
      topic,
      pipe(
        addSeqNumberCurry(sparkplug) as Modify<UPayload>,
        compressPayloadCurry(sparkplug.payloadOptions) as Modify<UPayload>,
        encodePayload,
        toBuffer,
      )(payload) as Buffer,
      client,
    );
  };

export const publishDeviceDeath = publishPayload("DDEATH");
export const publishDeviceBirth = publishPayload("DBIRTH");
export const publishDeviceData = publishPayload("DDATA");
export const publishNodeData = publishPayload("NDATA");

const createCommandPayload = (
  command: "NCMD" | "DCMD",
  commandName: string,
  value: UMetric["value"],
): UPayload => ({
  metrics: [
    {
      name: `${
        command == "NCMD" ? "Node Control" : "Device Control"
      }/${commandName}`,
      value,
      type: "Boolean",
    },
  ],
});

const publishCommand = (command: "NCMD" | "DCMD") =>
(
  sparkplug: SparkplugHost,
  commandName: string,
  value: UMetric["value"],
  groupId: string,
  edgeNode: string,
  mqttConfig: ISparkplugHostOptions,
  client: mqtt.MqttClient,
  deviceId?: string,
) => {
  const topic = createSpbTopic(
    command,
    { ...mqttConfig, groupId, edgeNode },
    deviceId,
  );
  const payload = createCommandPayload(command, commandName, value);
  publish(
    topic,
    pipe(
      addSeqNumberCurry(sparkplug) as Modify<UPayload>,
      compressPayloadCurry(sparkplug.payloadOptions) as Modify<UPayload>,
      encodePayload,
      toBuffer,
    )(payload) as Buffer,
    client,
  );
};

export const publishNodeCommand = publishCommand("NCMD");
export const publishDeviceCommand = publishCommand("DCMD");

/**
 * Publishes a message to an MQTT topic
 * @param {string} topic - The MQTT topic to publish to
 * @param {string | Buffer} message - The message to publish
 * @param {mqtt.MqttClient} client - The MQTT client instance
 */
export const publish = (
  topic: string,
  message: string | Buffer,
  client: mqtt.MqttClient,
) => {
  client.publish(topic, message);
};

/**
 * Subscribes to an MQTT topic
 * @param {string | string[]} topic - The topic(s) to subscribe to
 * @param {mqtt.IClientSubscribeOptions | mqtt.IClientSubscribeProperties | undefined} options - Subscription options
 * @param {mqtt.MqttClient} mqttClient - The MQTT client instance
 * @returns {mqtt.MqttClient} The MQTT client instance
 */
export const subscribe = (
  topic: string | string[],
  options:
    | mqtt.IClientSubscribeOptions
    | mqtt.IClientSubscribeProperties
    | undefined,
  mqttClient: mqtt.MqttClient,
) => {
  log.info("subscribed to " + topic);
  mqttClient.subscribe(topic, options);
  return mqttClient;
};

/**
 * Creates a curried function to subscribe to an MQTT topic
 * @param {string} topic - The topic to subscribe to
 * @param {mqtt.IClientSubscribeOptions} options - Subscription options
 * @returns {Function} A function that takes an MQTT client and subscribes to the topic
 */
export const subscribeCurry =
  (topic: string, options: mqtt.IClientSubscribeOptions) =>
  (mqttClient: mqtt.MqttClient) => subscribe(topic, options, mqttClient);

/**
 * Unsubscribes from an MQTT topic
 * @param {string} topic - The topic to unsubscribe from
 * @param {mqtt.IClientSubscribeOptions} options - Unsubscribe options
 * @param {mqtt.MqttClient} mqttClient - The MQTT client instance
 * @returns {mqtt.MqttClient} The MQTT client instance
 */
export const unsubscribe = (
  topic: string,
  options: mqtt.IClientSubscribeOptions,
  mqttClient: mqtt.MqttClient,
) => {
  log.info("unsubscribed from " + topic);
  mqttClient.unsubscribe(topic, options);
  return mqttClient;
};

/** Type for functions that modify a given type */
export type Modify<U> = (u: U) => U;

/**
 * Gets the death payload with the given birth/death sequence number
 * @param {number} bdSeq - Birth/death sequence number
 * @returns {UPayload} Death payload
 */
const getDeathPayload = (bdSeq: number): UPayload => ({
  timestamp: new Date().getTime(),
  metrics: [
    {
      name: "bdSeq",
      value: bdSeq,
      type: "UInt64",
    },
  ],
});

/**
 * Publishes the host online message
 * @param {SparkplugHost} host - The Sparkplug host instance
 */
export const publishHostOnline = (host: SparkplugHost) => {
  const topic = `STATE/${host.primaryHostId}`;
  const payload = "ONLINE";
  log.info("Publishing Primary Host Online.");
  host.mqtt?.publish(topic, payload, { retain: true });
};

/**
 * Creates an MQTT client for a Sparkplug host
 * @param {ISparkplugHostOptions} config - Host configuration options
 * @returns {mqtt.MqttClient} MQTT client instance
 */
export const createHostMqttClient = (config: ISparkplugHostOptions) => {
  const { serverUrl, clientId, keepalive, username, password, primaryHostId } =
    config;
  const mqttOptions: mqtt.IClientOptions = {
    ...(config.mqttOptions || {}), // allow additional options
    clientId,
    clean: true,
    keepalive,
    reschedulePings: false,
    connectTimeout: 30000,
    username,
    password,
    will: {
      topic: `STATE/${primaryHostId}`,
      payload: Buffer.from(`OFFLINE`, "utf8"),
      qos: 0,
      retain: true,
    },
  };
  return _internals.mqttConnect(serverUrl, mqttOptions);
};

/**
 * Creates an MQTT client for a Sparkplug edge node
 * @param {ISparkplugEdgeOptions} config - Edge node configuration options
 * @param {number} [bdSeq=0] - Initial birth/death sequence number
 * @returns {mqtt.MqttClient} MQTT client instance
 */
export const createMqttClient = (config: ISparkplugEdgeOptions, bdSeq = 0) => {
  const {
    serverUrl,
    clientId,
    keepalive,
    username,
    password,
    version,
    groupId,
    edgeNode,
  } = config;
  const mqttOptions: mqtt.IClientOptions = {
    ...(config.mqttOptions || {}), // allow additional options
    clientId,
    clean: true,
    keepalive,
    reschedulePings: false,
    connectTimeout: 30000,
    username,
    password,
    will: {
      topic: `${version}/${groupId}/NDEATH/${edgeNode}`,
      payload: pipe(encodePayload, toBuffer)(getDeathPayload(bdSeq)),
      qos: 0,
      retain: false,
    },
  };
  return _internals.mqttConnect(serverUrl, mqttOptions);
};

/**
 * Destroys the MQTT client
 * @param {mqtt.MqttClient | null} client - The MQTT client to destroy
 */
export const destroyMqttClient = (client: mqtt.MqttClient | null) => {
  if (client) client.end();
};

/** Input type for Sparkplug B message conditions and actions */
type SpbMessageConditionInput = { topic: SparkplugTopic; message: Buffer };

/** Type for Sparkplug B message condition functions */
type SpbMessageCondition = (input: SpbMessageConditionInput) => boolean;

/** Type for Sparkplug B message action functions */
type SpbMessageAction = (input: SpbMessageConditionInput) => void;

/** Type representing a conditional Sparkplug B message handler */
type SpbMessageConditional = {
  condition: SpbMessageCondition;
  action: SpbMessageAction;
};

/** Array of all Sparkplug B command types */
const commands = [
  "DDATA",
  "NBIRTH",
  "DBIRTH",
  "NDEATH",
  "DDEATH",
  "NDATA",
  "NCMD",
  "DCMD",
];

/** Array of Sparkplug B command types specific to edge nodes */
const edgeCommands = commands.filter((command) =>
  ["NCMD", "DCMD"].includes(command)
);

/**
 * Parses a Sparkplug B topic into a human-readable message
 * @param {SparkplugTopic} topic - The parsed Sparkplug B topic
 * @returns {string} A human-readable message describing the topic
 */
const parseTopicMessage = (topic: SparkplugTopic) => {
  const parts = [
    topic.groupId && `group: ${topic.groupId}`,
    topic.edgeNode && `node: ${topic.edgeNode}`,
    topic.deviceId && `device: ${topic.deviceId}`,
  ].filter(Boolean);
  return `${parts.join(", ")}`;
};

/**
 * Creates a command action for handling Sparkplug messages
 * @param {string} key - The command key
 * @param {EventEmitter} emitter - The event emitter instance
 * @returns {Function} A function that handles the command action
 */
const createCommandAction =
  (key: string, emitter: EventEmitter) =>
  ({ topic, message }: SpbMessageConditionInput) => {
    emitter.emit(
      key.toLowerCase(),
      topic,
      decodePayload(decompressPayload(message)),
    );
    log.debug(`${key} message received for ${parseTopicMessage(topic)}`);
  };

/**
 * Creates handlers for edge commands
 * @param {EventEmitter} emitter - The event emitter instance
 * @param {ISparkplugEdgeOptions} mqttConfig - The MQTT configuration for the edge
 * @returns {SpbMessageConditional[]} An array of command handlers
 */
const createHandleEdgeCommands = (
  emitter: EventEmitter,
  mqttConfig: ISparkplugEdgeOptions,
) => {
  return edgeCommands.map(
    (key): SpbMessageConditional => ({
      condition: ({ topic }) =>
        mqttConfig.version === topic.version &&
        mqttConfig.groupId === topic.groupId &&
        key === topic.commandType &&
        mqttConfig.edgeNode === topic.edgeNode,
      action: createCommandAction(key, emitter),
    }),
  );
};

/**
 * Creates handlers for host commands
 * @param {EventEmitter} emitter - The event emitter instance
 * @param {ISparkplugHostOptions} mqttConfig - The MQTT configuration for the host
 * @returns {SpbMessageConditional[]} An array of command handlers
 */
const createHandleHostCommands = (
  emitter: EventEmitter,
  mqttConfig: ISparkplugHostOptions,
) => {
  return commands.map(
    (key): SpbMessageConditional => ({
      condition: ({ topic }) =>
        mqttConfig.version === topic.version && key === topic.commandType,
      action: createCommandAction(key, emitter),
    }),
  );
};

/**
 * Parses a Sparkplug B topic string into its components
 * @param {string} topic - The Sparkplug B topic string to parse
 * @returns {SparkplugTopic} An object containing the parsed topic components
 */
export const parseSpbTopic = (topic: string): SparkplugTopic => {
  const [version, groupId, commandType, edgeNode, deviceId] = topic.split("/");
  return { version, groupId, commandType, edgeNode, deviceId };
};

/**
 * Handles incoming MQTT messages
 * @param {string} topic - The topic of the received message
 * @param {Buffer} message - The message payload
 * @param {EventEmitter} emitter - Event emitter to trigger events
 * @param {ISparkplugEdgeOptions | ISparkplugHostOptions} mqttConfig - MQTT configuration
 */
export const handleMessage = (
  topic: string,
  message: Buffer,
  emitter: EventEmitter,
  mqttConfig: ISparkplugEdgeOptions | ISparkplugHostOptions,
) => {
  const spbTopic = parseSpbTopic(topic);
  const isEdgeConfig = (
    config: ISparkplugEdgeOptions | ISparkplugHostOptions,
  ): config is ISparkplugEdgeOptions => {
    return "groupId" in config && "edgeNode" in config;
  };
  const handleCommands = isEdgeConfig(mqttConfig)
    ? createHandleEdgeCommands(emitter, mqttConfig)
    : createHandleHostCommands(emitter, mqttConfig);
  return cond({ topic: spbTopic, message }, [
    {
      condition: ({ topic }) => topic.version === "STATE",
      action: ({ topic, message }) => {
        log.info(
          `STATE message received for ${topic.groupId}, it is ${message.toString()}`,
        );
        emitter.emit("state", message.toString());
      },
    },
    ...handleCommands,
    {
      condition: () => true,
      action: ({ topic, message }) => {
        log.info(`Uncaught message received on topic ${topic}.`);
        emitter.emit(
          "message",
          topic,
          decodePayload(decompressPayload(message)),
        );
      },
    },
  ]);
};
