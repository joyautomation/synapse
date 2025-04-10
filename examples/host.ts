import { nanoid } from "nanoid";
import type { SparkplugCreateHostInput } from "../types.ts";
import { createHost } from "../stateMachines/host.ts";

const config: SparkplugCreateHostInput = {
  brokerUrl: Deno.env.get("MQTT_BROKER_URL") ||
    "ssl://mqtt3.anywherescada.com:8883",
  username: Deno.env.get("MQTT_USERNAME") || "",
  password: Deno.env.get("MQTT_PASSWORD") || "",
  id: "test",
  clientId: `test-${nanoid(7)}`,
  version: "spBv1.0",
  primaryHostId: "testHost",
  sharedSubscriptionGroup: "testGroup",
};

await createHost(config);
