import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { getMqttConfigFromSparkplug } from "./utils.ts";
import type { SparkplugHost, SparkplugNode } from "../types.ts";
import type { ISparkplugEdgeOptions, ISparkplugHostOptions } from "../types.ts";
import { EventEmitter } from "node:events";

const commonInput = {
  clientId: "test1",
  brokerUrl: "mqtt://example.com",
  username: "user",
  password: "pass",
  version: "spBv1.0",
  keepalive: 60,
  mqttOptions: {},
};

const expectedCommonOutput = {
  clientId: "test1",
  serverUrl: "mqtt://example.com",
  username: "user",
  password: "pass",
  version: "spBv1.0",
  keepalive: 60,
  mqttOptions: {},
};

describe("getMqttConfigFromSparkplug", () => {
  it("should return ISparkplugEdgeOptions for SparkplugNode input", () => {
    const nodeInput: SparkplugNode = {
      ...commonInput,
      groupId: "group1",
      id: "edge1",
      bdseq: 0,
      seq: 0,
      mqtt: null,
      states: {
        connected: { born: false, dead: false },
        disconnected: false,
      },
      events: new EventEmitter(),
      metrics: {},
      devices: {},
      scanRates: {},
    };

    const result = getMqttConfigFromSparkplug(nodeInput);

    const expected: ISparkplugEdgeOptions = {
      ...expectedCommonOutput,
      groupId: "group1",
      edgeNode: "edge1",
    };

    expect(result).toEqual(expected);
  });

  it("should return ISparkplugHostOptions for SparkplugHost input", () => {
    const hostInput: SparkplugHost = {
      id: "host1",
      ...commonInput,
      primaryHostId: "primary1",
      bdseq: 0,
      seq: 0,
      mqtt: null,
      states: {
        connected: false,
        disconnected: false,
      },
      events: new EventEmitter(),
      groups: {},
    };

    const result = getMqttConfigFromSparkplug(hostInput);

    const expected: ISparkplugHostOptions = {
      ...expectedCommonOutput,
      primaryHostId: "primary1",
    };

    expect(result).toEqual(expected);
  });

  it("should throw an error for invalid input", () => {
    const invalidInput = {
      ...commonInput,
      // Missing both groupId and primaryHostId
    } as unknown as Parameters<typeof getMqttConfigFromSparkplug>[0];

    expect(() => getMqttConfigFromSparkplug(invalidInput)).toThrow(
      "Invalid input type"
    );
  });
});
