import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  createHost,
  disconnectHost,
  extractAndStoreDefinitions,
  flattenHostGroups,
  flattenTemplateMetrics,
  getTemplateDefinitions,
} from "./host.ts";
import type { SparkplugCreateHostInput, SparkplugHost } from "../types.ts";
import type { UMetric } from "sparkplug-payload/lib/sparkplugbpayload.js";
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
                    properties: [],
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
                        properties: [],
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
                  properties: [],
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
                      properties: [],
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

  describe("flattenTemplateMetrics", () => {
    it("passes regular metrics through unchanged", () => {
      const metrics: UMetric[] = [
        { name: "temperature", type: "Double", value: 72.5 },
        { name: "running", type: "Boolean", value: true },
      ];
      const result = flattenTemplateMetrics(metrics);
      expect(result).toEqual([
        { name: "temperature", type: "Double", value: 72.5 },
        { name: "running", type: "Boolean", value: true },
      ]);
    });

    it("flattens a template instance into path-based scalar metrics", () => {
      const metrics: UMetric[] = [
        {
          name: "Pump1",
          type: "Template",
          value: {
            isDefinition: false,
            templateRef: "Pump_Type",
            metrics: [
              { name: "temperature", type: "Double", value: 72.5 },
              { name: "pressure", type: "Float", value: 100.0 },
            ],
          },
        },
      ];
      const result = flattenTemplateMetrics(metrics) as (UMetric & {
        templateChain?: string[];
        templateInstance?: string;
      })[];
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("Pump1/temperature");
      expect(result[0].type).toBe("Double");
      expect(result[0].value).toBe(72.5);
      expect(result[0].templateChain).toEqual(["Pump_Type"]);
      expect(result[0].templateInstance).toBe("Pump1");
      expect(result[1].name).toBe("Pump1/pressure");
      expect(result[1].templateChain).toEqual(["Pump_Type"]);
      expect(result[1].templateInstance).toBe("Pump1");
    });

    it("skips template definitions", () => {
      const metrics: UMetric[] = [
        {
          name: "Pump_Type",
          type: "Template",
          value: {
            isDefinition: true,
            metrics: [
              { name: "temperature", type: "Double", value: null },
              { name: "pressure", type: "Float", value: null },
            ],
          },
        },
        { name: "uptimeSeconds", type: "UInt64", value: 3600 },
      ];
      const result = flattenTemplateMetrics(metrics);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("uptimeSeconds");
    });

    it("handles mixed regular and template metrics", () => {
      const metrics: UMetric[] = [
        { name: "uptimeSeconds", type: "UInt64", value: 3600 },
        {
          name: "Pump1",
          type: "Template",
          value: {
            isDefinition: false,
            templateRef: "Pump_Type",
            metrics: [
              { name: "temperature", type: "Double", value: 72.5 },
            ],
          },
        },
        { name: "status", type: "String", value: "online" },
      ];
      const result = flattenTemplateMetrics(metrics);
      expect(result).toHaveLength(3);
      expect(result[0].name).toBe("uptimeSeconds");
      expect(result[1].name).toBe("Pump1/temperature");
      expect(result[2].name).toBe("status");
    });

    it("handles nested template instances recursively", () => {
      const metrics: UMetric[] = [
        {
          name: "Station1",
          type: "Template",
          value: {
            isDefinition: false,
            templateRef: "Station_Type",
            metrics: [
              {
                name: "Pump1",
                type: "Template",
                value: {
                  isDefinition: false,
                  templateRef: "Pump_Type",
                  metrics: [
                    { name: "temperature", type: "Double", value: 72.5 },
                  ],
                },
              },
              { name: "stationName", type: "String", value: "Main" },
            ],
          },
        },
      ];
      const result = flattenTemplateMetrics(metrics) as (UMetric & {
        templateChain?: string[];
        templateInstance?: string;
      })[];
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("Station1/Pump1/temperature");
      expect(result[0].templateChain).toEqual(["Station_Type", "Pump_Type"]);
      expect(result[0].templateInstance).toBe("Station1");
      expect(result[1].name).toBe("Station1/stationName");
      expect(result[1].templateChain).toEqual(["Station_Type"]);
      expect(result[1].templateInstance).toBe("Station1");
    });

    it("handles partial template updates (only changed members)", () => {
      const metrics: UMetric[] = [
        {
          name: "Pump1",
          type: "Template",
          value: {
            isDefinition: false,
            templateRef: "Pump_Type",
            metrics: [
              { name: "temperature", type: "Double", value: 75.0 },
            ],
          },
        },
      ];
      const result = flattenTemplateMetrics(metrics);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Pump1/temperature");
    });

    it("handles template with empty metrics array", () => {
      const metricsEmpty: UMetric[] = [
        {
          name: "Pump1",
          type: "Template",
          value: {
            isDefinition: false,
            templateRef: "Pump_Type",
            metrics: [],
          },
        },
      ];
      expect(flattenTemplateMetrics(metricsEmpty)).toHaveLength(0);
    });

    it("passes through template metric when value has no metrics key", () => {
      // A template value without a metrics key is not recognized as a template
      // and passes through as a regular metric (defensive handling)
      const metricsUndefined: UMetric[] = [
        {
          name: "Pump1",
          type: "Template",
          value: {
            isDefinition: false,
            templateRef: "Pump_Type",
          },
        },
      ];
      const result = flattenTemplateMetrics(metricsUndefined);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Pump1");
    });

    it("does not annotate regular metrics with template fields", () => {
      const metrics: UMetric[] = [
        { name: "temperature", type: "Double", value: 72.5 },
      ];
      const result = flattenTemplateMetrics(metrics) as (UMetric & {
        templateChain?: string[];
        templateInstance?: string;
      })[];
      expect(result[0].templateChain).toBeUndefined();
      expect(result[0].templateInstance).toBeUndefined();
    });

    it("annotates flat scalars with prefix-matched instance chain (Ignition pattern)", () => {
      // Ignition sends some UDT direct members as top-level flat scalars alongside
      // the template instance value — they share the same path prefix.
      const metrics: UMetric[] = [
        {
          name: "Motor1",
          type: "Template",
          value: {
            isDefinition: false,
            templateRef: "Motor_Type",
            // Only nested sub-UDT inside; direct scalars are sent flat below
            metrics: [
              {
                name: "subUDT",
                type: "Template",
                value: {
                  isDefinition: false,
                  templateRef: "Sub_Type",
                  metrics: [
                    { name: "subMetric", type: "Float", value: 1.0 },
                  ],
                },
              },
            ],
          },
        },
        // Direct UDT members sent as flat scalars at the payload root
        { name: "Motor1/ANYFAULT", type: "Boolean", value: false },
        { name: "Motor1/SPEED", type: "Float", value: 1450.0 },
        // Non-template metric — should NOT get a chain
        { name: "uptime", type: "UInt64", value: 3600 },
      ];
      const result = flattenTemplateMetrics(metrics) as (UMetric & {
        templateChain?: string[];
        templateInstance?: string;
      })[];

      const byName = Object.fromEntries(result.map((m) => [m.name, m]));

      // Nested scalar from the sub-UDT
      expect(byName["Motor1/subUDT/subMetric"].templateChain).toEqual([
        "Motor_Type",
        "Sub_Type",
      ]);

      // Flat scalars that were at the payload root — must be annotated via second pass
      expect(byName["Motor1/ANYFAULT"].templateChain).toEqual(["Motor_Type"]);
      expect(byName["Motor1/ANYFAULT"].templateInstance).toBe("Motor1");
      expect(byName["Motor1/SPEED"].templateChain).toEqual(["Motor_Type"]);
      expect(byName["Motor1/SPEED"].templateInstance).toBe("Motor1");

      // Non-template metric must NOT get a chain
      expect(byName["uptime"].templateChain).toBeUndefined();
    });
  });

  describe("extractAndStoreDefinitions", () => {
    it("stores template definitions in the host registry", () => {
      const testHost = {
        groups: {},
      } as unknown as SparkplugHost;
      const metrics: UMetric[] = [
        {
          name: "Pump_Type",
          type: "Template",
          value: {
            isDefinition: true,
            version: "1.0",
            metrics: [
              { name: "temperature", type: "Double", value: null },
              { name: "pressure", type: "Float", value: null },
            ],
          },
        },
        { name: "regular", type: "Int32", value: 42 },
      ];
      extractAndStoreDefinitions(testHost, metrics);
      const defs = getTemplateDefinitions(testHost);
      expect(defs.size).toBe(1);
      expect(defs.has("Pump_Type")).toBe(true);
      expect(defs.get("Pump_Type")?.version).toBe("1.0");
      expect(defs.get("Pump_Type")?.metrics).toHaveLength(2);
    });

    it("does not store template instances as definitions", () => {
      const testHost = {
        groups: {},
      } as unknown as SparkplugHost;
      const metrics: UMetric[] = [
        {
          name: "Pump1",
          type: "Template",
          value: {
            isDefinition: false,
            templateRef: "Pump_Type",
            metrics: [
              { name: "temperature", type: "Double", value: 72.5 },
            ],
          },
        },
      ];
      extractAndStoreDefinitions(testHost, metrics);
      const defs = getTemplateDefinitions(testHost);
      expect(defs.size).toBe(0);
    });
  });

  describe("template integration with host events", () => {
    it("flattens template metrics in nbirth messages", () => {
      host.events.emit(
        "nbirth",
        { groupId: "templateGroup", edgeNode: "templateNode" },
        {
          metrics: [
            {
              name: "Pump_Type",
              type: "Template",
              value: {
                isDefinition: true,
                version: "1.0",
                metrics: [
                  { name: "temperature", type: "Double", value: null },
                  { name: "running", type: "Boolean", value: null },
                ],
              },
            },
            {
              name: "Pump1",
              type: "Template",
              value: {
                isDefinition: false,
                templateRef: "Pump_Type",
                metrics: [
                  { name: "temperature", type: "Double", value: 72.5 },
                  { name: "running", type: "Boolean", value: true },
                ],
              },
            },
            { name: "uptimeSeconds", type: "UInt64", value: 3600 },
          ],
        },
      );
      const node = host.groups["templateGroup"]?.nodes["templateNode"];
      expect(node).toBeDefined();
      // Template definition should NOT be stored as a metric
      expect(node.metrics["Pump_Type"]).toBeUndefined();
      // Template instance should NOT be stored as a metric
      expect(node.metrics["Pump1"]).toBeUndefined();
      // Flattened members should be stored
      expect(node.metrics["Pump1/temperature"]).toBeDefined();
      expect(node.metrics["Pump1/temperature"].type).toBe("Double");
      expect(node.metrics["Pump1/temperature"].value).toBe(72.5);
      expect(node.metrics["Pump1/running"]).toBeDefined();
      expect(node.metrics["Pump1/running"].type).toBe("Boolean");
      expect(node.metrics["Pump1/running"].value).toBe(true);
      // Regular metric should still be stored
      expect(node.metrics["uptimeSeconds"]).toBeDefined();
      expect(node.metrics["uptimeSeconds"].value).toBe(3600);
      // Template definition should be in the registry
      const defs = getTemplateDefinitions(host);
      expect(defs.has("Pump_Type")).toBe(true);
    });

    it("flattens template metrics in ndata messages", () => {
      // First, set up the node via nbirth
      host.events.emit(
        "nbirth",
        { groupId: "dataGroup", edgeNode: "dataNode" },
        {
          metrics: [
            {
              name: "Pump1",
              type: "Template",
              value: {
                isDefinition: false,
                templateRef: "Pump_Type",
                metrics: [
                  { name: "temperature", type: "Double", value: 72.5 },
                ],
              },
            },
          ],
        },
      );
      // Now send a partial ndata update
      host.events.emit(
        "ndata",
        { groupId: "dataGroup", edgeNode: "dataNode" },
        {
          metrics: [
            {
              name: "Pump1",
              type: "Template",
              value: {
                isDefinition: false,
                templateRef: "Pump_Type",
                metrics: [
                  { name: "temperature", type: "Double", value: 85.0 },
                ],
              },
            },
          ],
        },
      );
      const node = host.groups["dataGroup"]?.nodes["dataNode"];
      expect(node.metrics["Pump1/temperature"].value).toBe(85.0);
    });

    it("preserves templateChain when a flat scalar DDATA update overwrites a template metric", () => {
      // DBIRTH with a full template instance — flattening annotates templateChain
      host.events.emit(
        "dbirth",
        { groupId: "chainGroup", edgeNode: "chainNode", deviceId: "chainDevice" },
        {
          metrics: [
            {
              name: "Motor1",
              type: "Template",
              value: {
                isDefinition: false,
                templateRef: "Motor_Type",
                metrics: [
                  { name: "speed", type: "Float", value: 1450.0 },
                  { name: "running", type: "Boolean", value: true },
                ],
              },
            },
          ],
        },
      );
      const device = host.groups["chainGroup"]?.nodes["chainNode"]
        ?.devices["chainDevice"];
      const speedMetric = device?.metrics["Motor1/speed"] as
        | (UMetric & { templateChain?: string[] })
        | undefined;
      expect(speedMetric?.templateChain).toEqual(["Motor_Type"]);
      expect(speedMetric?.value).toBe(1450.0);

      // DDATA arrives with just the scalar — no template wrapper, simulating Ignition behaviour
      host.events.emit(
        "ddata",
        { groupId: "chainGroup", edgeNode: "chainNode", deviceId: "chainDevice" },
        {
          metrics: [
            { name: "Motor1/speed", type: "Float", value: 1500.0 },
          ],
        },
      );
      const updatedSpeed = device?.metrics["Motor1/speed"] as
        | (UMetric & { templateChain?: string[] })
        | undefined;
      expect(updatedSpeed?.value).toBe(1500.0);
      // templateChain must be preserved from the DBIRTH
      expect(updatedSpeed?.templateChain).toEqual(["Motor_Type"]);
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
