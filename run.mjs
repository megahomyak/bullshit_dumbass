import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import * as fs from "node:fs";
import * as stream from "node:stream/promises";

let config = JSON.parse(fs.readFileSync("config.json", { encoding: "utf-8" }));

let elevenLabsClient = new ElevenLabsClient({
    apiKey: config["api_key"],
});

await stream.pipeline(
    await elevenLabsClient.textToSoundEffects.convert({ text: "metal pipe falling on the floor", promptInfluence: 1, outputFormat: "opus_48000_192" }), // Best-fidelity option: "pcm_24000". Using OPUS because at least I can listen to it through my audio players, and it also has metadata embedded which is really nice, PCM doesn't even save its own bit rate or anything else, I don't think it even has the magic file type bytes (what I call a "prefix")
    fs.createWriteStream("sound.opus"),
);
