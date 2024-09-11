import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createHost, disconnectHost } from "./host.ts";
import type { SparkplugCreateHostInput, SparkplugHost } from "../types.d.ts";
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

  it("changes to connected state when host connects", async () => {
    const mockOnConnect = spy();
    host.events.on("connected", mockOnConnect);
    host.mqtt?.emit("connect", connectPacket); //simulate receiving a connect even from MQTT
    assertSpyCalls(mockOnConnect, 1);
    expect(host.states).toEqual({
      connected: true,
      disconnected: false,
    });
  });

  it("disconnects properly when we tell it to", async () => {
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
