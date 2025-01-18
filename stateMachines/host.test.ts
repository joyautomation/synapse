import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createHost, disconnectHost, flattenHostGroups } from "./host.ts";
import type { SparkplugCreateHostInput, SparkplugHost } from "../types.ts";
import type { MqttClient } from "mqtt";
import type mqtt from "mqtt";
import { assertSpyCalls, spy, stub } from "@std/testing/mock";
import { _internals } from "../mqtt.ts";
import { EventEmitter } from "node:events";

const connectPacket: mqtt.IConnackPacket = {
  cmd: "connack",
  sessionPresent: false,
  returnCode: 0,
};

const disconnectPacket: mqtt.IDisconnectPacket = {
  cmd: "disconnect",
};

describe("The host state machine", () => {
  const mockConfig: SparkplugCreateHostInput = {
    brokerUrl: "mqtt://test.mosquitto.org",
    id: "testHost",
    clientId: "testClient",
    keepalive: 60,
    username: "testUser",
    password: "testPass",
    version: "spBv1.0",
    primaryHostId: "primaryHost",
  };
  let host: SparkplugHost;
  stub(console, "debug");
  stub(console, "info");
  stub(console, "error");
  stub(console, "warn");
  stub(console, "log");
  it("creates a host with correct properties", async () => {
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

    host = await createHost(mockConfig);
    assertSpyCalls(mqttConnectStub, 1);

    expect(host).toBeDefined();
    expect(host.id).toBe("testHost");
    expect(host.brokerUrl).toBe("mqtt://test.mosquitto.org");
    expect(host.clientId).toBe("testClient");
    expect(host.username).toBe("testUser");
    expect(host.password).toBe("testPass");
    expect(host.version).toBe("spBv1.0");
    expect(host.primaryHostId).toBe("primaryHost");
    expect(host.seq).toBe(0);
    expect(host.bdseq).toBe(0);
    expect(host.states).toEqual({
      connected: false,
      disconnected: true,
    });
    expect(host.events).toBeDefined();
    expect(host.mqtt).toBeDefined();
  });

  it("changes to connected state when host connects", () => {
    const mockOnConnect = spy();
    host.events.on("connected", mockOnConnect);
    host.mqtt?.emit("connect", connectPacket); //simulate receiving a connect even from MQTT
    assertSpyCalls(mockOnConnect, 1);
    expect(host.states).toEqual({
      connected: true,
      disconnected: false,
    });
  });

  it("stores the groupId and nodeId of nbirth messages", () => {
    host.events.emit(
      "nbirth",
      { groupId: "testGroup", edgeNode: "testNode" },
      {
        metrics: [{ name: "testMetric", type: "testType", value: "testValue" }],
      },
    );
    expect(host.groups["testGroup"]).toBeDefined();
    expect(host.groups["testGroup"].nodes["testNode"]).toBeDefined();
    expect(
      host.groups["testGroup"].nodes["testNode"].metrics["testMetric"],
    ).toBeDefined();
  });

  it("stores the deviceId of dbirth messages", () => {
    host.events.emit(
      "dbirth",
      { groupId: "testGroup", edgeNode: "testNode", deviceId: "testDevice" },
      {
        metrics: [{ name: "testMetric", type: "testType", value: "testValue" }],
      },
    );
    expect(host.groups["testGroup"]).toBeDefined();
    expect(host.groups["testGroup"].nodes["testNode"]).toBeDefined();
    expect(host.groups["testGroup"].nodes["testNode"].devices["testDevice"])
      .toBeDefined();
    expect(
      host.groups["testGroup"].nodes["testNode"].devices["testDevice"]
        .metrics["testMetric"],
    ).toBeDefined();
  });

  describe("flattenHostGroups", () => {
    it("flattens the host groups", () => {
      const host: SparkplugHost = {
        id: "testHost",
        groups: {
          group1: {
            id: "group1",
            nodes: {
              node1: {
                id: "node1",
                metrics: {
                  metric1: {
                    id: "metric1",
                    name: "metric1",
                    type: "metric1",
                    value: "metric1",
                  },
                },
                devices: {
                  device1: {
                    id: "device1",
                    metrics: {
                      metric2: {
                        id: "metric2",
                        name: "metric2",
                        type: "metric2",
                        value: "metric2",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      } as unknown as SparkplugHost;
      const flattened = flattenHostGroups(host);
      expect(flattened).toEqual([
        {
          id: "group1",
          name: "group1",
          nodes: [
            {
              id: "node1",
              name: "node1",
              metrics: [
                {
                  id: "metric1",
                  name: "metric1",
                  type: "metric1",
                  value: "metric1",
                },
              ],
              devices: [
                {
                  id: "device1",
                  name: "device1",
                  metrics: [
                    {
                      id: "metric2",
                      name: "metric2",
                      type: "metric2",
                      value: "metric2",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]);
    });
  });

  it("disconnects properly when we tell it to", () => {
    const mockOnDisconnect = spy();
    host.events.on("disconnected", mockOnDisconnect);
    disconnectHost(host);
    assertSpyCalls(mockOnDisconnect, 1);
    expect(host.states).toEqual({
      connected: false,
      disconnected: true,
    });
  });
});
