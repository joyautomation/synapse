import { describe, it } from "jsr:@std/testing/bdd";
import { expect } from "jsr:@std/expect";
import {
  spy,
  stub,
  assertSpyCall,
  assertSpyCalls,
  Spy,
} from "jsr:@std/testing/mock";
import {
  createMqttClient,
  createPayload,
  destroyMqttClient,
  handleMessage,
} from "./mqtt.ts";
import type{ ISparkplugEdgeOptions } from "./types.d.ts";
import type mqtt from "npm:mqtt";
import { EventEmitter } from "node:events";
import type { UPayload } from "npm:sparkplug-payload/lib/sparkplugbpayload.js";
import { Buffer } from "node:buffer";
import { _internals } from "./mqtt.ts";

describe("MQTT", () => {
  const mockConfig: ISparkplugEdgeOptions = {
    serverUrl: "mqtt://test.mosquitto.org",
    clientId: "testClient",
    keepalive: 60,
    username: "testUser",
    password: "testPass",
    version: "spBv1.0",
    groupId: "testGroup",
    edgeNode: "testEdge",
  };
  let client: mqtt.MqttClient;
  it("creates an MQTT client with correct options", () => {
    const mockClient: Partial<mqtt.MqttClient> = {
      connect: spy(),
      end: spy() as Spy<typeof mqtt.MqttClient.prototype.end>,
      publish: spy() as Spy<typeof mqtt.MqttClient.prototype.publish>,
      subscribe: spy() as Spy<typeof mqtt.MqttClient.prototype.subscribe>,
      unsubscribe: spy() as Spy<typeof mqtt.MqttClient.prototype.unsubscribe>,
      on: spy() as Spy<typeof mqtt.MqttClient.prototype.on>,
    };
    using mqttConnectStub = stub(_internals, "mqttConnect", () => {
      return mockClient as mqtt.MqttClient;
    });
    const bdSeq = 0;
    client = createMqttClient(mockConfig, bdSeq);
    assertSpyCalls(mqttConnectStub, 1)
    expect(client).toBeDefined();
  });
  it("handles messages correctly", () => {
    using debugStub = stub(console, "debug");
  using infoStub = stub(console, "info");
    const emitter = new EventEmitter();

  
    // Test NCMD message
    const ncmdTopic = "spBv1.0/testGroup/NCMD/testEdge";
    const payload: UPayload = { metrics: [] };
    const encodedPayload = createPayload(payload);
    const ncmdSpy = spy();
    emitter.on("ncmd", ncmdSpy);
  
    handleMessage(ncmdTopic, encodedPayload, emitter, mockConfig);
  
    assertSpyCall(ncmdSpy, 0, {
      args: [
        {
          groupId: "testGroup",
          commandType: "NCMD",
          edgeNode: "testEdge",
          deviceId: undefined,
          version: "spBv1.0",
        },
        {
          metrics: [],
        }
      ],
    });
    // Test STATE message
    const stateTopic = "STATE/testHost";
    const stateMessage = Buffer.from("ONLINE");
    const stateSpy = spy();
    emitter.on("state", stateSpy);
  
    handleMessage(stateTopic, stateMessage, emitter, mockConfig);
  
    assertSpyCall(stateSpy, 0, {
      args: ["ONLINE"],
    });
  
    // Test uncaught message
    const uncaughtTopic = "spBv1.0/testGroup/UNKNOWN/testEdge";
    const uncaughtMessage = encodedPayload;
    const messageSpy = spy();
    emitter.on("message", messageSpy);
  
    handleMessage(uncaughtTopic, uncaughtMessage, emitter, mockConfig);
    assertSpyCall(messageSpy, 0, {
      args: [
        {
          groupId: "testGroup",
          deviceId: undefined,
          commandType: "UNKNOWN",
          edgeNode: "testEdge",
          version: "spBv1.0",
        },
        {
          metrics: [],
        }
      ],
    });
  });
  
  it("destroys an MQTT client", () => {
    destroyMqttClient(client);
    assertSpyCalls(client.end as Spy<typeof mqtt.MqttClient.prototype.end>, 1);
  });
});

