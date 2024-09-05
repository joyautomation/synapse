import { describe, it } from "jsr:@std/testing/bdd";
import { expect } from "jsr:@std/expect";
import { getMqttConfigFromSparkplug } from "./utils.ts";
import { SparkplugHost, SparkplugNode } from "../types.d.ts";

import { ISparkplugEdgeOptions, ISparkplugHostOptions } from "../types.d.ts";

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
    } as SparkplugNode;

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
      ...commonInput,
      primaryHostId: "primary1",
    } as SparkplugHost;

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
    } as any;

    expect(() => getMqttConfigFromSparkplug(invalidInput)).toThrow(
      "Invalid input type"
    );
  });
});
