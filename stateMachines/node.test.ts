import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  createNode,
  disconnectNode,
  metricNeedsToPublish,
  nodeTransitions,
} from "./node.ts";
import type {
  SparkplugCreateNodeInput,
  SparkplugMetric,
  SparkplugNode,
} from "../types.ts";
import type { IDisconnectPacket, MqttClient } from "mqtt";
import type mqtt from "mqtt";
import { assertSpyCalls, Spy, spy, stub } from "@std/testing/mock";
import { EventEmitter } from "node:events";
import { _internals } from "../mqtt.ts";
import { getUnixTime } from "date-fns";

const connectPacket: mqtt.IConnackPacket = {
  cmd: "connack",
  sessionPresent: false,
  returnCode: 0,
};

const disconnectPacket: IDisconnectPacket = {
  cmd: "disconnect",
};

stub(console, "debug");
stub(console, "info");
stub(console, "error");
const warnStub = stub(console, "warn");
// stub(console, "log");

describe("Node", () => {
  const mockConfig: SparkplugCreateNodeInput = {
    id: "testNode",
    groupId: "testGroup",
    brokerUrl: "mqtt://test.mosquitto.org",
    clientId: "testClient",
    username: "testUser",
    password: "testPass",
    metrics: {
      testMetric: {
        name: "testMetric",
        type: "String",
        value: "testValue",
      },
    },
    devices: {
      testDevice: {
        id: "testDevice",
        metrics: {
          testMetric: {
            name: "testMetric",
            type: "String",
            value: "testValue",
            scanRate: 1000,
          },
        },
      },
    },
  };
  let node: SparkplugNode;
  it("creates a node with correct properties", () => {
    const mockClient = new EventEmitter() as unknown as mqtt.MqttClient;
    mockClient.subscribe = spy() as typeof MqttClient.prototype.subscribe;
    mockClient.unsubscribe = spy() as typeof MqttClient.prototype.unsubscribe;
    mockClient.publish = spy() as typeof MqttClient.prototype.publish;
    mockClient.connect = (() => {
      mockClient.emit("connect", connectPacket);
    }) as typeof MqttClient.prototype.connect;
    mockClient.end = (() => {
      mockClient.emit("disconnect", disconnectPacket);
    }) as typeof MqttClient.prototype.end;

    using mqttConnectStub = stub(_internals, "mqttConnect", () => {
      return mockClient as mqtt.MqttClient;
    });

    node = createNode(mockConfig);

    assertSpyCalls(mqttConnectStub, 1);

    expect(node).toBeDefined();
    expect(node.id).toBe("testNode");
    expect(node.groupId).toBe("testGroup");
    expect(node.brokerUrl).toBe("mqtt://test.mosquitto.org");
    expect(node.clientId).toBe("testClient");
    expect(node.username).toBe("testUser");
    expect(node.password).toBe("testPass");
    expect(node.devices).toHaveProperty("testDevice");
    expect(node.seq).toBe(0);
    expect(node.bdseq).toBe(0);
    expect(node.states).toEqual({
      connected: {
        born: false,
        dead: false,
      },
      disconnected: true,
    });
    expect(node.events).toBeDefined();
    expect(node.mqtt).toBeDefined();
    expect(node.scanRates).toEqual({});
    expect(node.metrics).toEqual({
      testMetric: {
        name: "testMetric",
        type: "String",
        value: "testValue",
      },
    });
  });
  it("changes to connected state when node connects", async () => {
    const mockOnConnect = spy();
    node.events.on("connected", mockOnConnect);
    const packet: mqtt.IConnackPacket = {
      cmd: "connack",
      sessionPresent: false,
      returnCode: 0,
    };
    node.mqtt?.emit("connect", packet); //simulate receiving a connect even from MQTT
    assertSpyCalls(mockOnConnect, 1);
    expect(node.states).toEqual({
      connected: {
        born: true,
        dead: false,
      },
      disconnected: false,
    });
  });
  describe("birth transition", () => {
    it("publishes a birth message if the mqtt client exists.", async () => {
      const calls = (node.mqtt?.publish as Spy).calls.length;
      await nodeTransitions.birth(node);
      expect(node.mqtt?.publish).toBeDefined();
      if (node.mqtt?.publish) {
        assertSpyCalls(node.mqtt.publish as Spy, calls + 1);
      }
    });
    it("publishes nothing if the mqtt client doesn't exist.", () => {
      nodeTransitions.birth({} as SparkplugNode);
      assertSpyCalls(warnStub, 1);
    });
  });
  describe("Report By Exception", () => {
    it("is true if lastPublished value is null", () => {
      const testMetric: SparkplugMetric = {
        name: "testMetric",
        type: "Int32",
        value: 101,
        deadband: {
          value: 100,
          maxTime: 1000,
        },
        lastPublished: {
          timestamp: getUnixTime(new Date()),
          value: null,
        },
        scanRate: 1000,
      };
      expect(metricNeedsToPublish(testMetric)).toBe(true);
    });
    it("is false if lastPublished value is not null", () => {
      const testMetric: SparkplugMetric = {
        name: "testMetric",
        type: "Int32",
        value: 101,
        deadband: {
          value: 100,
          maxTime: 1000,
        },
        lastPublished: {
          timestamp: getUnixTime(new Date()),
          value: 100,
        },
        scanRate: 1000,
      };
      expect(metricNeedsToPublish(testMetric)).toBe(false);
    });
  });
  it("disconnects properly when we tell it to", async () => {
    const mockOnDisconnect = spy();
    node.events.on("disconnected", mockOnDisconnect);
    disconnectNode(node);
    assertSpyCalls(mockOnDisconnect, 1);
    expect(node.states).toEqual({
      connected: {
        born: false,
        dead: false,
      },
      disconnected: true,
    });
  });
});
