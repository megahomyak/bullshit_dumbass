import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import Groq from "groq-sdk";
import * as fs from "node:fs/promises";
import * as childProcess from "node:child_process";

let config = JSON.parse(await fs.readFile("config.json", { encoding: "utf-8" }));

let elevenLabsClient = new ElevenLabsClient({
    apiKey: config["eleven_labs_api_key"],
});
let groqClient = new Groq({
    apiKey: config["groq_api_key"],
});

let ensure = async (filePath, defaultMaker) => {
    let exists = false;
    try {
        await fs.stat(filePath);
        exists = true;
    } catch {}
    if (!exists) {
        await defaultMaker(filePath);
    }
    return filePath;
};
let read = async (filePath, options, defaultMaker) => {
    await ensure(filePath, async path => {
        await fs.writeFile(path, await defaultMaker(), options);
    });
    return await fs.readFile(filePath, options);
};
let spawn = (command, args) => new Promise(resolve => childProcess.spawn(command, args).on("exit", resolve));

let script = read("script", { encoding: "utf-8" }, async () => {
    let setting = await fs.readFile("setting", { encoding: "utf-8" });
    return (await groqClient.chat.completions.create({
        messages: [
            {
                role: "system",
                content: "The user will provide a setting for a one-sided roleplay document; please, respond ONLY WITH text in the following format:\n"
                + "\n"
                + "say <phrase>\n"
                + "wait <number of seconds, real>\n"
                + "play <sound desc>\n"
                + "\n"
                + "EXAMPLE:\n"
                + "say finally, it's time to do the maintenance in the extremely dangerous metal-pipes-falling-on-workers'-feet-area!\n"
                + "wait 2.5\n"
                + "play metal pipe loudly falling on the floor\n"
                + "say AW FUCK, MY FOOT!",
            },
            {
                role: "user",
                content: setting,
            },
        ],
        model: "llama-3.3-70b-versatile",
    })).choices[0].message.content;
}).trim();
let soxParams = [];
for (let line of script.split("\n")) {
    let handlers = [
        [/^say\s+(?<phrase>.+)$/, async groups => {
            await fs.mkdir("sayings", { recursive: true });
            return await ensure("sayings/" + Buffer.from(groups.phrase).toString("base64url"), async path => {
                // TODO
            });
        }],
        [/^wait\s+(?<timeSeconds>.+)$/, async groups => {
            await fs.mkdir("waits", { recursive: true });
            return await ensure("waits/" + Buffer.from(groups.timeSeconds).toString("base64url"), async path => {
                await spawn("sox", `-n -r 48000 ${path} trim 0.0 ${groups.timeSeconds}`.split());
            });
        }],
        [/^play\s+(?<soundDescription>.+)$/, async groups => {
            await fs.mkdir("sounds", { recursive: true });
            return await ensure("sounds/" + Buffer.from(groups.soundDescription).toString("base64url"), async path => {
                await fs.writeFile(
                    path,
                    await elevenLabsClient.textToSoundEffects.convert({ text: groups.soundDescription, promptInfluence: 1, outputFormat: "opus_48000_192" }), // Best-fidelity option: "pcm_24000". Using OPUS because at least I can listen to it through my audio players, and it also has metadata embedded which is really nice, PCM doesn't even save its own bit rate or anything else, I don't think it even has the magic file type bytes (what I call a "prefix")
                );
            });
        }],
    ];
    await (async () => {
        for (let [regex, handler] in handlers) {
            let match = line.match(regex);
            if (match != null) {
                soxParams.push(await handler(match.groups));
                return;
            }
        }
        throw new Error(`WTF?line: ${line}`);
    })();
}
await spawn("sox", [...soxParams, "outfile.wav"]);
