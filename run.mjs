import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import Groq from "groq-sdk";
import * as fs from "node:fs/promises";
import * as process from "node:process";

let config = JSON.parse(await fs.readFile("config.json", { encoding: "utf-8" }));

let elevenLabsClient = new ElevenLabsClient({
    apiKey: config["eleven_labs_api_key"],
});
let groqClient = new Groq({
    apiKey: config["groq_api_key"],
});

let ensure = async (fileName, options, defaultMaker) => await (async function ensure() {
    try {
        return await fs.readFile(fileName, options);
    } catch {
        let newContents = await defaultMaker();
        await fs.writeFile(fileName, newContents, options);
        return await ensure();
    }
})();
let read = async (fileName, options, defaultMaker) => {
    await ensure(fileName, options, defaultMaker);
};
let script = ensure("script", { encoding: "utf-8" }, async () => {
    let setting = await fs.readFile("setting", { encoding: "utf-8" });
    return (await groqClient.chat.completions.create({
        messages: [
            {
                role: "system",
                content: "The user will provide a TODO !!!!!!!!",
            },
            {
                role: "user",
                content: setting,
            },
        ],
        model: "llama-3.3-70b-versatile",
    })).choices[0].message.content;
}).trim();
for (let line of script.split("\n")) {
    let handlers = [
        [/^say\s+(?<stereoBalance>[+-]?\d*\.?\d+)\s+(?<phrase>.+)$/, groups => {
            ensure()
        }]
    ];
    let sayMatch = line.match();
    if (sayMatch != null) {

    } else {

    }
}

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
