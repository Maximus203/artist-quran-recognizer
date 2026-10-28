import { describe, expect, it, vi } from "vitest";
import { compactResult, handleRpc, TOOLS, type ApiCall } from "./mcp";

const ID = "87b80f10-aeea-408b-a579-34ac7c23ae30";

function ctx(scope: "read" | "write", call?: ApiCall) {
  return {
    scope,
    call:
      call ??
      (vi.fn(async () => ({ status: 200, body: {} })) as unknown as ApiCall),
  };
}

const rpc = (method: string, params?: Record<string, unknown>, id = 1) =>
  ({ jsonrpc: "2.0", id, method, params }) as never;

describe("serveur MCP", () => {
  it("négocie la version et annonce les outils", async () => {
    const init = (await handleRpc(
      rpc("initialize", { protocolVersion: "2025-03-26" }),
      ctx("read"),
    )) as { result: { protocolVersion: string; serverInfo: { name: string } } };
    expect(init.result.protocolVersion).toBe("2025-03-26");
    expect(init.result.serverInfo.name).toBe("quran-tr");
    const unknown = (await handleRpc(
      rpc("initialize", { protocolVersion: "1999-01-01" }),
      ctx("read"),
    )) as { result: { protocolVersion: string } };
    expect(unknown.result.protocolVersion).toBe("2025-06-18");
    const list = (await handleRpc(rpc("tools/list"), ctx("read"))) as {
      result: { tools: { name: string }[] };
    };
    expect(list.result.tools.map((t) => t.name)).toEqual(
      TOOLS.map((t) => t.name),
    );
  });

  it("ne répond pas à une notification", async () => {
    const notification = {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    };
    expect(await handleRpc(notification as never, ctx("read"))).toBeNull();
  });

  it("refuse une méthode inconnue et une requête mal formée", async () => {
    const unknown = (await handleRpc(rpc("nope"), ctx("read"))) as {
      error: { code: number };
    };
    expect(unknown.error.code).toBe(-32601);
    const bad = (await handleRpc({ id: 1 } as never, ctx("read"))) as {
      error: { code: number };
    };
    expect(bad.error.code).toBe(-32600);
  });

  it("refuse l'import à un jeton en lecture seule, sans appeler l'API", async () => {
    const context = ctx("read");
    const reply = (await handleRpc(
      rpc("tools/call", {
        name: "create_recording",
        arguments: { filename: "a.mp3", audio_base64: "AAAA" },
      }),
      context,
    )) as { result: { isError: boolean; content: { text: string }[] } };
    expect(reply.result.isError).toBe(true);
    expect(reply.result.content[0].text).toMatch(/lecture seule/);
    expect(context.call).not.toHaveBeenCalled();
  });

  it("importe en privé par défaut et lance l'analyse", async () => {
    const call = vi.fn(async () => ({
      status: 201,
      body: { id: ID, state: "queued" },
    }));
    const reply = (await handleRpc(
      rpc("tools/call", {
        name: "create_recording",
        arguments: { filename: "récit.mp3", audio_base64: "AAAA" },
      }),
      ctx("write", call as unknown as ApiCall),
    )) as { result: { isError?: boolean } };
    expect(reply.result.isError).toBeUndefined();
    const [method, path, options] = call.mock.calls[0] as unknown as [
      string,
      string,
      { headers: Record<string, string> },
    ];
    expect(method).toBe("POST");
    expect(path).toContain("visibility=private");
    expect(path).toContain("autorun=1");
    expect(options.headers["x-aqr-filename"]).toBe(
      encodeURIComponent("récit.mp3"),
    );
  });

  it("refuse un identifiant qui n'est pas un UUID", async () => {
    const reply = (await handleRpc(
      rpc("tools/call", { name: "get_recording", arguments: { id: "../x" } }),
      ctx("read"),
    )) as { result: { isError: boolean } };
    expect(reply.result.isError).toBe(true);
  });

  it("traduit une erreur de l'API en message d'outil, sans fuite interne", async () => {
    const call = vi.fn(async () => ({
      status: 404,
      body: { error: "Session introuvable" },
    }));
    const reply = (await handleRpc(
      rpc("tools/call", { name: "get_recording", arguments: { id: ID } }),
      ctx("read", call as unknown as ApiCall),
    )) as { result: { isError: boolean; content: { text: string }[] } };
    expect(reply.result.isError).toBe(true);
    expect(reply.result.content[0].text).toContain("Session introuvable");
  });

  it("projette le résultat sans rien inventer", () => {
    const compact = compactResult({
      intervals: [
        {
          kind: "verse",
          ref: "91:1",
          t: [0.4, 4.9],
          status: "recognized",
          partial: true,
          text: "وَٱلشَّمْسِ",
          translation: { text: "Par le soleil", attribution: "QuranEnc" },
        },
        { kind: "abstention" },
      ],
    }) as { verses: Record<string, unknown>[]; non_quran_or_abstained: number };
    expect(compact.verses).toEqual([
      {
        ref: "91:1",
        start_s: 0.4,
        end_s: 4.9,
        status: "recognized",
        partial: true,
        arabic: "وَٱلشَّمْسِ",
        translation: "Par le soleil",
        translation_source: "QuranEnc",
      },
    ]);
    expect(compact.non_quran_or_abstained).toBe(1);
    expect(compactResult(null)).toBeNull();
  });
});

describe("outils d'export vidéo et de gestion", () => {
  const callTool = async (
    name: string,
    args: Record<string, unknown>,
    call: ApiCall,
  ) =>
    (await handleRpc(
      rpc("tools/call", { name, arguments: args }),
      ctx("write", call),
    )) as { result: { isError?: boolean; content: { text: string }[] } };

  it("transmet cadence, résolution, plages et un verset par vidéo à l'API", async () => {
    const call = vi.fn(async () => ({
      status: 202,
      body: { job: { id: "j" } },
    })) as unknown as ApiCall;
    await callTool(
      "export_video",
      {
        id: ID,
        fps: 60,
        resolution: 2160,
        ranges: [{ start: 1, end: 9 }],
        per_verse: false,
        orientation: "9:16",
      },
      call,
    );
    expect(call).toHaveBeenCalledWith(
      "POST",
      `/api/sessions/${ID}/export/video/jobs`,
      {
        json: {
          options: {
            orientation: "9:16",
            fps: 60,
            resolution: 2160,
            ranges: [{ start: 1, end: 9 }],
            per_verse: false,
          },
        },
      },
    );
  });

  it("liste un lien par vidéo quand l'export est terminé", async () => {
    const call = vi.fn(async () => ({
      status: 200,
      body: {
        job: {
          state: "done",
          downloads: [
            { index: 0, name: "a.mp4", url: "file" },
            { index: 1, name: "b.mp4", url: "file?index=1" },
          ],
        },
      },
    })) as unknown as ApiCall;
    const reply = await callTool("get_video_export", { id: ID, job: ID }, call);
    const body = JSON.parse(reply.result.content[0].text) as {
      download_paths: { name: string; path: string }[];
    };
    expect(body.download_paths.map((d) => d.path)).toEqual([
      `/api/v1/recordings/${ID}/export/video/jobs/${ID}/file`,
      `/api/v1/recordings/${ID}/export/video/jobs/${ID}/file?index=1`,
    ]);
  });

  it("refuse de supprimer sans confirmation explicite, sans appeler l'API", async () => {
    const call = vi.fn() as unknown as ApiCall;
    const reply = await callTool("delete_recording", { id: ID }, call);
    expect(reply.result.isError).toBe(true);
    expect(call).not.toHaveBeenCalled();
    const ok = vi.fn(async () => ({
      status: 200,
      body: { ok: true },
    })) as unknown as ApiCall;
    await callTool("delete_recording", { id: ID, confirm: true }, ok);
    expect(ok).toHaveBeenCalledWith("DELETE", `/api/sessions/${ID}`);
  });

  it("renomme, met en favori et lance l'analyse par les bonnes routes", async () => {
    const call = vi.fn(async () => ({
      status: 200,
      body: {},
    })) as unknown as ApiCall;
    await callTool("update_recording", { id: ID, name: "Yasin" }, call);
    await callTool("set_favorite", { id: ID, favorite: true }, call);
    await callTool("set_favorite", { id: ID, favorite: false }, call);
    await callTool("run_analysis", { id: ID }, call);
    expect(call).toHaveBeenCalledWith("PATCH", `/api/sessions/${ID}`, {
      json: { name: "Yasin" },
    });
    expect(call).toHaveBeenCalledWith("PUT", `/api/sessions/${ID}/favorite`);
    expect(call).toHaveBeenCalledWith("DELETE", `/api/sessions/${ID}/favorite`);
    expect(call).toHaveBeenCalledWith("POST", `/api/sessions/${ID}/run`, {
      json: {},
    });
  });

  it("n'accepte pas une modification vide", async () => {
    const reply = await callTool(
      "update_recording",
      { id: ID },
      vi.fn() as unknown as ApiCall,
    );
    expect(reply.result.isError).toBe(true);
  });
});
