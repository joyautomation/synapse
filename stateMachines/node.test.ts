import { describe, it } from "jsr:@std/testing/bdd";
import { expect } from "jsr:@std/expect";
import { createNode, disconnectNode } from "./node.ts";
import type { SparkplugCreateNodeInput, SparkplugNode } from "../types.d.ts";
import type { IDisconnectPacket, MqttClient } from "npm:mqtt";
import type mqtt from "npm:mqtt";
import { assertSpyCalls, spy, stub } from "jsr:@std/testing/mock";
import { EventEmitter } from "node:events";
import { _internals } from "../mqtt.ts";

const connectPacket: mqtt.IConnackPacket = {
  cmd: "connack",
  sessionPresent: false,
  returnCode: 0,
};

const disconnectPacket: IDisconnectPacket = {
  cmd: "disconnect",
};

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
          },
        },
      },
    },
  };
  let node: SparkplugNode;
  stub(console, "debug");
  stub(console, "info");
  stub(console, "error");
  stub(console, "warn");
  stub(console, "log");
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
