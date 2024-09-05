import { nanoid } from "npm:nanoid@5.0.7";
import type { SparkplugCreateHostInput } from "../types.d.ts";
import { createHost } from "../stateMachines/host.ts";

const config: SparkplugCreateHostInput = {
  brokerUrl: "ssl://mqtt3.anywherescada.com:8883",
  username: Deno.env.get("MQTT_USERNAME") || "",
  password: Deno.env.get("MQTT_PASSWORD") || "",
  id: "test",
  clientId: `test-${nanoid(7)}`,
  version: "spBv1.0",
  primaryHostId: "testHost",
};

await createHost(config);
