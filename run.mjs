import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import * as fs from "node:fs";
import * as stream from "node:stream/promises";

let config = JSON.parse(fs.readFileSync("config.json", { encoding: "utf-8" }));

let elevenLabsClient = new ElevenLabsClient({
    apiKey: config["api_key"],
});

await stream.pipeline(
    await elevenLabsClient.textToSoundEffects.convert({ text: "metal pipe falling on the floor", promptInfluence: 1, outputFormat: "opus_48000_192" }),
    fs.createWriteStream("sound.opus"),
);
