import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { compressPayload, decompressPayload, hasAlgorithm } from "./index.ts";
import {
  encodePayload,
  type UPayload,
} from "sparkplug-payload/lib/sparkplugbpayload.js";
import { deflate, gzip } from "pako";
import { assertSpyCalls, stub } from "@std/testing/mock";
import Long from "long";

describe("hasAlgorithm", () => {
  it("returns true if there is a metric with the name algorithm", () => {
    const payload: UPayload = {
      timestamp: new Date().getTime(),
      metrics: [
        {
          name: "algorithm",
          type: "String",
          value: "GZIP",
        },
      ],
    };
    expect(hasAlgorithm(payload.metrics)).toBe(true);
  });
  it("returns false if there is no metric with the name algorithm", () => {
    const payload: UPayload = {
      timestamp: new Date().getTime(),
      metrics: [],
    };
    expect(hasAlgorithm(payload.metrics)).toBe(false);
    payload.metrics = [
      {
        name: "aMetric",
        type: "UInt64",
        value: 12345,
      },
    ];
    expect(hasAlgorithm(payload.metrics)).toBe(false);
  });
  it("returns false if metrics is null or undefined", () => {
    expect(hasAlgorithm(null)).toBe(false);
    expect(hasAlgorithm(undefined)).toBe(false);
  });
});

describe("compressPayload", () => {
  const payload: UPayload = {
    timestamp: new Date().getTime(),
    metrics: [
      {
        name: "aMetric",
        value: 12345,
        type: "UInt64",
      },
    ],
  };
  const encodedPayload = encodePayload(payload);
  const _uncompressedPayload = {
    body: encodePayload(payload),
  };
  const gzippedPayload = {
    metrics: [
      {
        name: "algorithm",
        type: "String",
        value: "GZIP",
      },
    ],
    body: gzip(encodedPayload),
  };
  const deflatedPayload = {
    metrics: [
      {
        name: "algorithm",
        type: "String",
        value: "DEFLATE",
      },
    ],
    body: deflate(encodedPayload),
  };
  it("returns uncompressed payload if there are no options or compression defined", () => {
    expect(compressPayload(undefined, payload)).toEqual(payload);
    expect(compressPayload({}, payload)).toEqual(payload);
  });
  it("returns uncompressed payload if compress is false", () => {
    expect(compressPayload({ compress: false }, payload)).toEqual(payload);
  });
  it("returns uncompressed payload and logs a message if compression algorithm is undefined", () => {
    using errorStub = stub(console, "error");
    expect(compressPayload({ compress: true }, payload)).toEqual(payload);
    assertSpyCalls(errorStub, 1);
  });
  it("returns uncompressed payload and logs a message if compression algorithm is not supported.", () => {
    using errorStub = stub(console, "error");
    const badAlgorithm = "BadAlgorithm" as "GZIP";
    expect(
      compressPayload({ compress: true, algorithm: badAlgorithm }, payload),
    ).toEqual(payload);
    assertSpyCalls(errorStub, 1);
  });
  it("GZIPs", () => {
    expect(
      compressPayload({ compress: true, algorithm: "GZIP" }, payload),
    ).toEqual(gzippedPayload);
  });
  it("DEFLATEs", () => {
    expect(
      compressPayload({ compress: true, algorithm: "DEFLATE" }, payload),
    ).toEqual(deflatedPayload);
  });
});

describe("decompressPayload", () => {
  const payload: UPayload = {
    timestamp: new Date().getTime(),
    metrics: [
      {
        name: "aMetric",
        value: 12345,
        type: "UInt32",
      },
    ],
  };
  const expectedPayload = {
    timestamp: Long.fromValue({
      high: Long.fromNumber(new Date().getTime()).high,
      low: Long.fromNumber(new Date().getTime()).low,
      unsigned: true,
    }),
    metrics: [
      {
        name: "aMetric",
        value: Long.fromValue({
          high: 0,
          low: 12345,
          unsigned: true,
        }),
        type: "UInt32",
      },
    ],
  };
  const encodedPayload = encodePayload(payload);
  const gzippedPayload: UPayload = {
    metrics: [
      {
        name: "algorithm",
        type: "String",
        value: "GZIP",
      },
    ],
    body: gzip(encodedPayload),
  };
  const deflatedPayload: UPayload = {
    metrics: [
      {
        name: "algorithm",
        type: "String",
        value: "DEFLATE",
      },
    ],
    body: deflate(encodedPayload),
  };
  it("UNGZIPs", () => {
    expect(decompressPayload(gzippedPayload)).toEqual(expectedPayload);
  });
  it("INFLATEs", () => {
    expect(decompressPayload(deflatedPayload)).toEqual(expectedPayload);
  });
});
