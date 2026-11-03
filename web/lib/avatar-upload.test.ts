import { describe, expect, it } from "vitest";
import { readLimitedBody } from "./avatar-upload";

const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request("http://127.0.0.1:3000/api/me/avatar", {
    method: "PUT",
    body,
    headers,
    // @ts-expect-error Node exige `duplex` pour un corps en flux
    duplex: "half",
  });

describe("readLimitedBody : lecture bornée du corps", () => {
  it("lit un corps sous la limite", async () => {
    const bytes = await readLimitedBody(post(Buffer.from("abc")), 10);
    expect(bytes && Buffer.from(bytes).toString()).toBe("abc");
  });

  it("renvoie un tableau vide pour un corps absent", async () => {
    const bytes = await readLimitedBody(post(null), 10);
    expect(bytes?.length).toBe(0);
  });

  it("refuse d'emblée un Content-Length au-dessus de la limite", async () => {
    const request = post(Buffer.alloc(5), { "content-length": "999" });
    expect(await readLimitedBody(request, 10)).toBeNull();
  });

  it("refuse un Content-Length illisible", async () => {
    const request = post(Buffer.alloc(5), { "content-length": "abc" });
    expect(await readLimitedBody(request, 10)).toBeNull();
  });

  it("coupe un flux qui dépasse la limite sans Content-Length honnête", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(6));
        controller.enqueue(new Uint8Array(6));
        controller.close();
      },
    });
    expect(await readLimitedBody(post(stream), 10)).toBeNull();
  });

  it("accepte exactement la limite", async () => {
    const bytes = await readLimitedBody(post(Buffer.alloc(10)), 10);
    expect(bytes?.length).toBe(10);
  });
});
