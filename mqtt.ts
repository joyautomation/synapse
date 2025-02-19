import * as mqtt from "mqtt";
import type {
  ISparkplugEdgeOptions,
  ISparkplugHostOptions,
  SparkplugHost,
  SparkplugNode,
  SparkplugTopic,
} from "./types.ts";
import * as sparkplug from "npm:sparkplug-payload@1.0.3";
import { pipe } from "@joyautomation/dark-matter";
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
import type { PayloadOptions } from "./compression/types.ts";
import { cond, isBuffer } from "./utils.ts";
import type { EventEmitter } from "node:events";
import { Buffer } from "node:buffer";

/**
 * Wrapper function to connect to an MQTT broker
 * @param {string} url - The URL of the MQTT broker
 * @param {mqtt.IClientOptions} options - MQTT client options
 * @returns {mqtt.MqttClient} MQTT client instance
 */
export function mqttConnect(
  url: string,
  options: mqtt.IClientOptions
): mqtt.MqttClient {
  return mqtt.connect(url, options);
}

/**
 * Internal utilities exposed for testing purposes
 * @internal
 */
export const _internals = {
  mqttConnect,
};

/** Sparkplug B protocol version */
const version: string = "spBv1.0";

/** Sparkplug B payload encoder/decoder instance */
const spb: {
  encodePayload: (object: UPayload) => Uint8Array;
  decodePayload: (proto: Uint8Array) => UPayload;
} = sparkplug.get(version)!;

/**
 * Encodes a Sparkplug B payload object into a Uint8Array
 * @param {UPayload} payload - The Sparkplug B payload object to encode
 * @returns {Uint8Array} The encoded payload as a Uint8Array
 */
export const encodePayload: (payload: UPayload) => Uint8Array =
  spb.encodePayload;

/**
 * Decodes a Sparkplug B payload from a Uint8Array into a payload object
 * @param {Uint8Array} buffer - The Uint8Array containing the encoded Sparkplug B payload
 * @returns {UPayload} The decoded Sparkplug B payload object
 */
export const decodePayload: (buffer: Uint8Array) => UPayload =
  spb.decodePayload;

/**
 * Converts a Uint8Array to a Buffer
 * @param {Uint8Array} payload - The payload to convert
 * @returns {Buffer} The converted Buffer
 */
const toBuffer = (payload: Uint8Array): Buffer => Buffer.from(payload);

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
  deviceId?: string
): string =>
  `${version}/${groupId}/${commandType}/${edgeNode}${
    deviceId ? "/" + deviceId : ""
  }`;

/**
 * Creates a payload buffer from a given payload object
 * @param {any} payload - The payload object to encode
 * @returns {Buffer} Encoded payload as a Buffer
 */
export const createPayload = (payload: UPayload): Buffer =>
  pipe(payload, encodePayload, toBuffer);

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
  (bdSeq: number) =>
  (payload: UPayload): UPayload =>
    addBdSeqMetric(bdSeq, payload);

/**
 * Adds a sequence number to the given payload
 * @param {SparkplugNode | SparkplugHost} sparkplug - Sparkplug node or host instance
 * @param {UPayload} payload - The payload to modify
 * @returns {UPayload} Modified payload with sequence number added
 */
export const addSeqNumber = (
  sparkplug: SparkplugNode | SparkplugHost,
  payload: UPayload
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
  (sparkplug: SparkplugNode | SparkplugHost) =>
  (payload: UPayload): UPayload =>
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
): void => {
  const payload = getDeathPayload(bdSeq);
  const topic = createSpbTopic("NDEATH", mqttConfig);
  publish(topic, pipe(payload, encodePayload, toBuffer), client);
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
  _seq: number,
  options: PayloadOptions | undefined,
  payload: UPayload,
  mqttConfig: ISparkplugEdgeOptions,
  client: mqtt.MqttClient
): void => {
  const topic = createSpbTopic("NBIRTH", mqttConfig);
  publish(
    topic,
    pipe(
      payload,
      addBdSeqMetricCurry(bdSeq),
      compressPayloadCurry(options),
      encodePayload,
      toBuffer
    ) as Buffer,
    client
  );
  log.info(`published node ${mqttConfig.edgeNode} birth`);
};

/**
 * Function type for publishing Sparkplug B payloads (DBIRTH, DDEATH, DDATA, or NDATA)
 * @internal
 */
export type PublishPayload = ReturnType<typeof publishPayload>;

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
    deviceId?: string
  ): void => {
    const topic = createSpbTopic(command, mqttConfig, deviceId);
    if (command === "NDATA") {
      log.debug(`Publishing NDATA on node ${mqttConfig.edgeNode}`);
    } else {
      log.debug(
        `Publishing Device ${deviceId} ${command} on node ${mqttConfig.edgeNode}`
      );
    }
    publish(
      topic,
      pipe(
        payload,
        addSeqNumberCurry(sparkplug) as Modify<UPayload>,
        compressPayloadCurry(sparkplug.payloadOptions) as Modify<UPayload>,
        encodePayload,
        toBuffer
      ) as Buffer,
      client
    );
    sparkplug.events.emit(`publish-${command.toLowerCase()}`, topic, payload);
  };

/**
 * Publishes a device birth message
 * @param {SparkplugNode} sparkplug - The Sparkplug node instance
 * @param {UPayload} payload - The payload to publish
 * @param {ISparkplugEdgeOptions} mqttConfig - MQTT configuration options
 * @param {mqtt.MqttClient} client - MQTT client instance
 * @param {string} [deviceId] - Optional device identifier
 */
export const publishDeviceBirth: PublishPayload = publishPayload("DBIRTH");

/**
 * Publishes a device death (DDEATH) message to a Sparkplug B MQTT topic
 * @param {SparkplugNode} sparkplug - The Sparkplug node instance
 * @param {UPayload} payload - The payload to publish
 * @param {ISparkplugEdgeOptions} mqttConfig - MQTT configuration options
 * @param {mqtt.MqttClient} client - MQTT client instance
 * @param {string} [deviceId] - Optional device identifier
 */
export const publishDeviceDeath: PublishPayload = publishPayload("DDEATH");

/**
 * Publishes device data (DDATA) message to a Sparkplug B MQTT topic
 * @param {SparkplugNode} sparkplug - The Sparkplug node instance
 * @param {UPayload} payload - The payload containing device metrics
 * @param {ISparkplugEdgeOptions} mqttConfig - MQTT configuration options
 * @param {mqtt.MqttClient} client - MQTT client instance
 * @param {string} [deviceId] - Optional device identifier
 */
export const publishDeviceData: PublishPayload = publishPayload("DDATA");

/**
 * Publishes node data (NDATA) message to a Sparkplug B MQTT topic
 * @param {SparkplugNode} sparkplug - The Sparkplug node instance
 * @param {UPayload} payload - The payload containing node metrics
 * @param {ISparkplugEdgeOptions} mqttConfig - MQTT configuration options
 * @param {mqtt.MqttClient} client - MQTT client instance
 */
export const publishNodeData: PublishPayload = publishPayload("NDATA");

const createCommandPayload = (
  command: "NCMD" | "DCMD",
  commandName: string,
  type: UMetric["type"],
  value: UMetric["value"]
): UPayload => ({
  metrics: [
    {
      name: `${
        command == "NCMD" ? "Node Control" : "Device Control"
      }/${commandName}`,
      value,
      type,
    },
  ],
});

/**
 * Type representing a function that publishes Sparkplug B commands (NCMD or DCMD)
 * @internal
 */
export type PublishCommand = ReturnType<typeof publishCommand>;

/**
 * Creates a function to publish Sparkplug B commands (NCMD or DCMD)
 * @param {("NCMD" | "DCMD")} command - The type of command to publish (Node or Device)
 * @returns {Function} A function that publishes the specified command type with the following parameters:
 *   - sparkplug: SparkplugHost - The Sparkplug host instance
 *   - commandName: string - Name of the command to publish
 *   - type: UMetric["type"] - Type of the metric value
 *   - value: UMetric["value"] - Value of the metric
 *   - groupId: string - Sparkplug group identifier
 *   - edgeNode: string - Edge node identifier
 *   - mqttConfig: ISparkplugHostOptions - MQTT configuration options
 *   - client: mqtt.MqttClient - MQTT client instance
 *   - deviceId?: string - Optional device identifier (only for DCMD)
 */
const publishCommand =
  (command: "NCMD" | "DCMD") =>
  (
    sparkplug: SparkplugHost,
    commandName: string,
    type: UMetric["type"],
    value: UMetric["value"],
    groupId: string,
    edgeNode: string,
    mqttConfig: ISparkplugHostOptions,
    client: mqtt.MqttClient,
    deviceId?: string
  ): void => {
    const topic = createSpbTopic(
      command,
      { ...mqttConfig, groupId, edgeNode },
      deviceId
    );
    const payload = createCommandPayload(command, commandName, type, value);
    publish(
      topic,
      pipe(
        payload,
        addSeqNumberCurry(sparkplug) as Modify<UPayload>,
        compressPayloadCurry(sparkplug.payloadOptions) as Modify<UPayload>,
        encodePayload,
        toBuffer
      ) as Buffer,
      client
    );
    sparkplug.events.emit(`publish-${command.toLowerCase()}`, topic, payload);
  };

/**
 * Publishes a node command (NCMD) message to a Sparkplug B MQTT topic
 * @param {SparkplugHost} sparkplug - The Sparkplug host instance
 * @param {string} commandName - Name of the command to publish
 * @param {UMetric["type"]} type - Type of the metric value
 * @param {UMetric["value"]} value - Value of the metric
 * @param {string} groupId - Sparkplug group identifier
 * @param {string} edgeNode - Edge node identifier
 * @param {ISparkplugHostOptions} mqttConfig - MQTT configuration options
 * @param {mqtt.MqttClient} client - MQTT client instance
 */
export const publishNodeCommand: PublishCommand = publishCommand("NCMD");
/**
 * Publishes a device command (DCMD) message to a Sparkplug B MQTT topic
 * @param {SparkplugHost} sparkplug - The Sparkplug host instance
 * @param {string} commandName - Name of the command to publish
 * @param {UMetric["type"]} type - Type of the metric value
 * @param {UMetric["value"]} value - Value of the metric
 * @param {string} groupId - Sparkplug group identifier
 * @param {string} edgeNode - Edge node identifier
 * @param {ISparkplugHostOptions} mqttConfig - MQTT configuration options
 * @param {mqtt.MqttClient} client - MQTT client instance
 * @param {string} [deviceId] - Optional device identifier
 */
export const publishDeviceCommand: PublishCommand = publishCommand("DCMD");

/**
 * Publishes a message to an MQTT topic
 * @param {string} topic - The MQTT topic to publish to
 * @param {string | Buffer} message - The message to publish
 * @param {mqtt.MqttClient} client - The MQTT client instance
 */
export const publish = (
  topic: string,
  message: Buffer,
  client: mqtt.MqttClient
): void => {
  try {
    client.publish(topic, message);
  } catch (error: unknown) {
    if (error instanceof Error) {
      log.error(`Error publishing message to topic ${topic}: ${error.stack}`);
    } else {
      log.error(`Error publishing message to topic ${topic}: ${String(error)}`);
    }
  }
};

/**
 * Subscribes to an MQTT topic
 * @param {string | string[]} topic - The topic(s) to subscribe to
 * @param {mqtt.IClientSubscribeOptions | mqtt.IClientSubscribeProperties | undefined} options - Subscription options
 * @param {mqtt.MqttClient} mqttClient - The MQTT client instance
 * @returns {mqtt.MqttClient} The MQTT client instance
 */
export const subscribe = (
  topic: string,
  options: mqtt.IClientSubscribeOptions,
  mqttClient: mqtt.MqttClient,
  sharedGroup?: string
): mqtt.MqttClient => {
  const fullTopic = `${sharedGroup ? `$share/${sharedGroup}/` : ""}${topic}`;
  log.info("subscribed to " + fullTopic);
  mqttClient.subscribe(fullTopic, options);
  return mqttClient;
};

/**
 * Creates a curried function to subscribe to an MQTT topic
 * @param {string} topic - The topic to subscribe to
 * @param {mqtt.IClientSubscribeOptions} options - Subscription options
 * @returns {Function} A function that takes an MQTT client and subscribes to the topic
 */
export const subscribeCurry =
  (topic: string, options: mqtt.IClientSubscribeOptions, sharedGroup?: string) =>
  (mqttClient: mqtt.MqttClient): mqtt.MqttClient =>
    subscribe(topic, options, mqttClient, sharedGroup);

/**
 * Unsubscribes from an MQTT topic
 * @param {string} topic - The topic to unsubscribe from
 * @param {mqtt.IClientSubscribeOptions} options - Unsubscribe options
 * @param {mqtt.MqttClient} mqttClient - The MQTT client instance
 * @returns {mqtt.MqttClient} The MQTT client instance
 */
export const unsubscribe = (topic: string, client: mqtt.MqttClient, sharedGroup?: string): void => {
  log.info("unsubscribed from " + topic);
  client.unsubscribe(`${sharedGroup ? `$share/${sharedGroup}/` : ""}${topic}`);
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
export const publishHostOnline = (host: SparkplugHost): void => {
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
export const createHostMqttClient = (
  config: ISparkplugHostOptions
): mqtt.MqttClient => {
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
export const createMqttClient = (
  config: ISparkplugEdgeOptions,
  bdSeq = 0
): mqtt.MqttClient => {
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
      payload: pipe(getDeathPayload(bdSeq), encodePayload, toBuffer),
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
export const destroyMqttClient = (client: mqtt.MqttClient | null): void => {
  client?.end();
};

/** Input type for Sparkplug B message conditions and actions */
type SpbMessageConditionInput = {
  topic: SparkplugTopic;
  message: UPayload | Uint8Array;
};

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
    const decompressed = decompressPayload(message);
    if (isBuffer(decompressed)) {
      const decoded = decodePayload(decompressed);
      emitter.emit(key.toLowerCase(), topic, decoded);
    }
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
  mqttConfig: ISparkplugEdgeOptions
) => {
  return edgeCommands.map(
    (key): SpbMessageConditional => ({
      condition: ({ topic }) =>
        mqttConfig.version === topic.version &&
        mqttConfig.groupId === topic.groupId &&
        key === topic.commandType &&
        mqttConfig.edgeNode === topic.edgeNode,
      action: createCommandAction(key, emitter),
    })
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
  mqttConfig: ISparkplugHostOptions
) => {
  return commands.map(
    (key): SpbMessageConditional => ({
      condition: ({ topic }) =>
        mqttConfig.version === topic.version && key === topic.commandType,
      action: createCommandAction(key, emitter),
    })
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
  mqttConfig: ISparkplugEdgeOptions | ISparkplugHostOptions
): void => {
  const spbTopic = parseSpbTopic(topic);
  const isEdgeConfig = (
    config: ISparkplugEdgeOptions | ISparkplugHostOptions
  ): config is ISparkplugEdgeOptions => {
    return "groupId" in config && "edgeNode" in config;
  };
  const handleCommands = isEdgeConfig(mqttConfig)
    ? createHandleEdgeCommands(emitter, mqttConfig)
    : createHandleHostCommands(emitter, mqttConfig);
  // Convert Buffer to Uint8Array
  const messageArray = new Uint8Array(
    message.buffer,
    message.byteOffset,
    message.byteLength
  );
  return cond({ topic: spbTopic, message: messageArray }, [
    {
      condition: ({ topic }) => topic.version === "STATE",
      action: ({ topic, message }) => {
        const state = Buffer.from(message).toString();
        log.info(`STATE message received for ${topic.groupId}, it is ${state}`);
        const primaryHostId = topic.groupId;
        emitter.emit("state", state, primaryHostId);
      },
    },
    ...handleCommands,
    {
      condition: () => true,
      action: ({ topic, message }) => {
        try {
          const decompressed = decompressPayload(message);
          if (isBuffer(decompressed)) {
            const decoded = decodePayload(decompressed);
            log.debug(`Uncaught message received on topic ${topic}.`);
            emitter.emit("message", topic, decoded);
          }
        } catch (_error) {
          const payload = Buffer.from(message).toString();
          log.info(
            `Uncaught non-decompressable, undecodable message received for ${topic} with payload ${payload}`
          );
          emitter.emit("message", topic, payload);
        }
      },
    },
  ]);
};
