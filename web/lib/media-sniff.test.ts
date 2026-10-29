import { describe, expect, it } from "vitest";
import { sniffMedia } from "./media-sniff";

const bytes = (...parts: Array<string | number[]>): Buffer =>
  Buffer.concat(
    parts.map((part) =>
      typeof part === "string"
        ? Buffer.from(part, "latin1")
        : Buffer.from(part),
    ),
  );
const pad = (head: Buffer) => Buffer.concat([head, Buffer.alloc(64)]);

describe("type réel d'un envoi (signature du contenu)", () => {
  it.each([
    ["MP3 avec étiquette ID3", pad(bytes("ID3", [3, 0, 0, 0, 0, 0, 0]))],
    [
      "MP3 sans étiquette (synchronisation de trame)",
      pad(bytes([0xff, 0xfb, 0x90, 0x00])),
    ],
    ["AAC ADTS", pad(bytes([0xff, 0xf1, 0x50, 0x80]))],
    ["WAV", pad(bytes("RIFF", [0x24, 0, 0, 0], "WAVEfmt "))],
    ["AVI", pad(bytes("RIFF", [0x24, 0, 0, 0], "AVI LIST"))],
    ["Ogg (OGG, Opus)", pad(bytes("OggS", [0, 2]))],
    ["FLAC", pad(bytes("fLaC", [0, 0, 0, 0x22]))],
    ["MP4 / M4A / MOV (ftyp)", pad(bytes([0, 0, 0, 0x20], "ftypisom"))],
    ["Matroska / WebM", pad(bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f]))],
  ])("%s est reconnu comme un média", (_name, content) => {
    expect(sniffMedia(content).ok).toBe(true);
  });

  it.each([
    ["page HTML", pad(bytes("<!DOCTYPE html><html><script>alert(1)</script>"))],
    ["page HTML sans doctype", pad(bytes("  <html><body>"))],
    [
      "SVG avec script",
      pad(bytes("<svg xmlns='http://www.w3.org/2000/svg' onload='x()'>")),
    ],
    ["exécutable Windows (MZ)", pad(bytes("MZ", [0x90, 0, 3, 0]))],
    ["exécutable Linux (ELF)", pad(bytes([0x7f], "ELF", [2, 1, 1]))],
    ["archive ZIP", pad(bytes("PK", [3, 4, 20, 0]))],
    ["archive RAR", pad(bytes("Rar!", [0x1a, 7, 0]))],
    ["PDF", pad(bytes("%PDF-1.7"))],
    ["image PNG", pad(bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a]))],
    ["image JPEG", pad(bytes([0xff, 0xd8, 0xff, 0xe0]))],
    ["script shell", pad(bytes("#!/bin/sh\nrm -rf /"))],
    [
      "RIFF qui n'est ni WAV ni AVI (WebP)",
      pad(bytes("RIFF", [0x24, 0, 0, 0], "WEBPVP8 ")),
    ],
    ["fichier de zéros", Buffer.alloc(128)],
    ["vide", Buffer.alloc(0)],
    ["trop court", bytes("ID")],
  ])("%s est refusé", (_name, content) => {
    const verdict = sniffMedia(content);
    expect(verdict.ok).toBe(false);
  });

  it("dit en clair ce qui ne va pas, sans citer le contenu", () => {
    const verdict = sniffMedia(pad(bytes("<html>secret</html>")));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.message).toMatch(/pas un audio ou une vidéo/i);
      expect(verdict.message).not.toContain("secret");
    }
  });

  it("une vraie signature n'est pas confondue avec du texte qui la contient plus loin", () => {
    expect(
      sniffMedia(
        bytes(
          "<html>",
          "ID3",
          [3, 0, 0, 0, 0, 0, 0],
          Buffer.alloc(64).toString("latin1"),
        ),
      ).ok,
    ).toBe(false);
  });
});
