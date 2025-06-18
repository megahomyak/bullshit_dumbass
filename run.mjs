import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import Groq from "groq-sdk";
import * as fsPromises from "node:fs/promises";
import * as childProcess from "node:child_process";

let config = JSON.parse(await fsPromises.readFile("config.json", { encoding: "utf-8" }));

let elevenLabsClient = new ElevenLabsClient({
    apiKey: config["eleven_labs_api_key"],
});
let groqClient = new Groq({
    apiKey: config["groq_api_key"],
});

let speechifyNarrate = async (voiceId, refreshToken, phrase) => {
    let token1 = (await (await fetch("https://securetoken.googleapis.com/v1/token?key=AIzaSyDbAIg5AN6Cb5kITejfovleb5VDWw0Kv7s", {
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `grant_type=refresh_token&refresh_token=${refreshToken}`,
        method: "POST",
    })).json()).access_token;
    let token2 = (await (await fetch("https://auth.api.speechify.com/v1/id-tokens", {
        headers: {
            "Content-Type": "application/json",
            authorization: `Bearer ${token1}`,
        },
        method: "POST",
        body: JSON.stringify({
            projectId: "videostudio-production"
        }),
    })).json()).token;
    return (await (await fetch("https://videostudio.api.speechify.com/graphql", {
        headers: {
            "Content-Type": "application/json",
            authorization: `Bearer ${token2}`,
        },
        method: "POST",
        body: JSON.stringify({
            operationName: "PreviewScratchpad",
            query: "query PreviewScratchpad($ttsInput: TTSInput!) { scratchpadPreviewV2(args: $ttsInput) { contentType cdnUrl durationMs data { correlationId } } }",
            variables: {
                ttsInput: {
                    content: [{ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: phrase }] }] }],
                    forceRegenerate: false,
                    format: "MP3",
                    options: { emotion: null, pitch: 0, speed: 0 },
                    voiceId,
                },
            },
        }),
    })).json()).data.scratchpadPreviewV2.cdnUrl;
};

let ensure = async (filePath, defaultMaker) => {
    let exists = false;
    try {
        await fsPromises.stat(filePath);
        exists = true;
    } catch { }
    if (!exists) {
        await defaultMaker(filePath);
    }
    return filePath;
};
let ensureWrite = async (filePath, options, defaultMaker) => await ensure(filePath, async path => await fsPromises.writeFile(path, await defaultMaker(), options));
let read = async (filePath, options, defaultMaker) => {
    await ensure(filePath, async path => {
        await fsPromises.writeFile(path, await defaultMaker(), options);
    });
    return await fsPromises.readFile(filePath, options);
};
let spawn = (command, args) => {
    console.log(command, args);
    return new Promise(resolve => childProcess.spawn(command, args).on("exit", resolve));
};

let script = await read("script", { encoding: "utf-8" }, async () => {
    let setting = await fsPromises.readFile("setting", { encoding: "utf-8" });
    return (await groqClient.chat.completions.create({
        messages: [
            {
                role: "system",
                content: "The user will provide a setting for a one-sided roleplay document; please, respond ONLY WITH text with commands in one the following formats:\n"
                    + "\n"
                    + "FORMAT 1: play <duration of sound in seconds, must be at least 0.5 and at most 22> <description of sound>\n"
                    + "FORMAT 2: wait <number of seconds, real>\n"
                    + "FORMAT 3: say <phrase>\n"
                    + "\n"
                    + "RESPONSE EXAMPLE:\n"
                    + "say finally!"
                    + "say it's time to do the maintenance in the extremely dangerous metal-pipes-falling-on-workers'-feet-area!\n"
                    + "wait 2.5\n"
                    + "play 1.5 metal pipe loudly falling on the floor\n"
                    + "say AW FUCK, MY FOOT!\n"
                    + "wait 1\n"
                    + "say stupid pipe...\n"
                    + "play 1 door closing\n"
                    + "say I hope this will be the last time this happens...\n"
                    + "\n"
                    + "Please, keep in mind that it will be much better if you use commands in a randomized order, which is possible and encouraged"
            },
            {
                role: "user",
                content: setting,
            },
        ],
        model: "llama-3.3-70b-versatile",
    })).choices[0].message.content;
});
let voiceId = (await fsPromises.readFile("speechify_voice_id", { encoding: "utf-8" })).trim();
let soxParams = [];
for (let line of script.trim().split("\n")) {
    console.log(line);
    /*
    ON OUTPUT FORMAT OPTIONS:
    Best-fidelity option: "pcm_24000". Using OPUS because at least I can listen to it through my audio players, and it also has metadata embedded which is really nice, PCM doesn't even save its own bit rate or anything else, I don't think it even has the magic file type bytes (what I call a "prefix").
    */
    let handlers = [
        [/^say\s+(?<phrase>.+)$/, async groups => {
            await fsPromises.mkdir("sayings", { recursive: true });
            return await ensure("sayings/" + Buffer.from(groups.phrase).toString("base64url") + ".wav", async path => {
                let sayingUrl = await speechifyNarrate(voiceId, config["speechify_refresh_token"], groups.phrase);
                await spawn("wget", `${sayingUrl} -O ${path}.mp3`.split(" "));
                await spawn("ffmpeg", `-i ${path}.mp3 -ac 2 -ar 48000 ${path}`.split(" "));
            });
        }],
        [/^wait\s+(?<timeSeconds>.+)$/, async groups => {
            await fsPromises.mkdir("waits", { recursive: true });
            return await ensure("waits/" + Buffer.from(groups.timeSeconds).toString("base64url") + ".wav", async path => {
                await spawn("sox", `-n -c 2 -r 48000 ${path} trim 0.0 ${groups.timeSeconds}`.split(" "));
            });
        }],
        [/^play\s+(?<durationSeconds>\d*.?\d+)\s+(?<soundDescription>.+)$/, async groups => {
            await fsPromises.mkdir("sounds", { recursive: true });
            return await ensure("sounds/" + Buffer.from(groups.soundDescription).toString("base64url") + ".wav", async path => {
                await fsPromises.writeFile(
                    path + ".opus",
                    await elevenLabsClient.textToSoundEffects.convert({ durationSeconds: parseFloat(groups.durationSeconds), text: groups.soundDescription, promptInfluence: 1, outputFormat: "opus_48000_192" }),
                );
                await spawn("ffmpeg", `-i ${path}.opus -ar 48000 ${path}`.split(" "));
            });
        }],
    ];
    await (async () => {
        for (let [regex, handler] of handlers) {
            let match = line.match(regex);
            if (match != null) {
                soxParams.push(await handler(match.groups));
                return;
            }
        }
        throw new Error(`WTF?line: "${line}"`);
    })();
}
await spawn("sox", [...soxParams, "outfile.wav"]);
