import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import * as fs from "node:fs/promises";
import * as process from "node:process";

let config = JSON.parse(await fs.readFile("config.json", { encoding: "utf-8" }));

let elevenLabsClient = new ElevenLabsClient({
    apiKey: config["eleven_labs_api_key"],
});

let ensure = async (fileName, defaultMaker) => {
    let exists = false;
    try {
        await fs.stat(fileName);
        exists = true;
    } catch {}
    if (!exists) {
        await fs.writeFile(fileName, await defaultMaker());
    }
    return fileName;
};

ensure("script", )

let soxParams = [];
fs.readFile("script", { encoding: "utf-8" });
process.execve("sox", soxParams);

let read = async (path, defaultGenerator) => {
    try {
        return await fs.readFile(path, { encoding: "utf-8" });
    } catch {
        let newContents = await defaultGenerator();
        await fs.writeFile(path, newContents, { encoding: "utf-8" });
        return newContents;
    }
};

    await elevenLabsClient.textToSpeech.convert(await read("voice_id", async () => {

    }));

let getSound = async soundDescription => {
    let soundFileName = Buffer.from(soundDescription).toString("base64url");
    return await read(soundFileName, async () => {

    });
await fs.writeFile(
    await elevenLabsClient.textToSoundEffects.convert({ text: "metal pipe falling on the floor", promptInfluence: 1, outputFormat: "opus_48000_192" }), // Best-fidelity option: "pcm_24000". Using OPUS because at least I can listen to it through my audio players, and it also has metadata embedded which is really nice, PCM doesn't even save its own bit rate or anything else, I don't think it even has the magic file type bytes (what I call a "prefix")
);
};
