import * as NodeCrypto from "node:crypto";

import { assert, describe, it } from "@effect/vitest";

import {
  encryptPayload,
  fromBase64Url,
  generateVapidKey,
  vapidAuthorization,
  vapidPublicKey,
} from "./WebPush.ts";

describe("WebPush", () => {
  // RFC 8291 appendix A: the only evidence that does not come from this implementation.
  it("encrypts the RFC 8291 example message byte for byte", () => {
    const body = encryptPayload({
      plaintext: new TextEncoder().encode("When I grow up, I want to be a watermelon"),
      p256dh:
        "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
      auth: "BTBZMqHH6r4Tts7J_aSIgg",
      salt: fromBase64Url("DGv6ra1nlYgDCS1FRnbzlw"),
      senderPrivateKey: fromBase64Url("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"),
    });
    assert.equal(
      body.toString("base64url"),
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    );
  });

  it("signs a VAPID token the push service can verify with the public key", () => {
    const key = generateVapidKey();
    const header = vapidAuthorization({
      endpoint: "https://web.push.apple.com/some/long/path",
      key,
      nowMs: 1_800_000_000_000,
    });
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    assert.isNotNull(match);
    const [, head, claims, signature, publicKey] = match!;
    assert.equal(publicKey, vapidPublicKey(key));
    const payload = JSON.parse(Buffer.from(claims!, "base64url").toString());
    assert.equal(payload.aud, "https://web.push.apple.com");
    assert.equal(payload.exp, 1_800_000_000 + 12 * 60 * 60);
    const verified = NodeCrypto.verify(
      "sha256",
      Buffer.from(`${head}.${claims}`),
      {
        key: NodeCrypto.createPublicKey({
          key: { kty: "EC", crv: "P-256", x: key.x, y: key.y },
          format: "jwk",
        }),
        dsaEncoding: "ieee-p1363",
      },
      fromBase64Url(signature!),
    );
    assert.isTrue(verified);
  });
});
