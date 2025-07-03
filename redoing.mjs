import * as fsPromises from "node:fs/promises";
import * as childProcess from "node:child_process";
import * as path from "node:path";
import * as crypto from "node:crypto";
import Groq from "groq-sdk";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

// Works like "GNU make", but only checks for the existence of the file: runs "maker" if the file by filepath doesn't exist. Returns nothing. Logs file presence. Example: await make("myfile.txt", async filepath => await fs.writeFile(filepath, "Hello, world!"))
let make = async (filepath, maker) => {
    try {
        await fsPromises.stat(filepath);
        console.log(`${filepath} present`);
    } catch {
        console.log(`${filepath} not present, making...`);
        await maker(filepath);
    }
    return filepath;
};

// Executes the provided command with the provided args, throws an error if the execution fails, returns the contents of the standard output as a Buffer. Example: await exec("ls", ["-l"])
let exec = async (command, args) => new Promise((resolve, reject) => {
    console.log(command + " " + args.join(" "));
    let process = childProcess.spawn(command, args, {
        stdio: [
            "ignore",
            "pipe",
            "inherit",
        ],
    });
    let stdoutChunks = [];
    process.stdout.on("data", chunk => stdoutChunks.push(chunk));
    process.on("close", code => {
        if (code == 0) { resolve(Buffer.concat(stdoutChunks)); }
        else { reject(new Error(`exited with ${code}`)); }
    });
});

// Compiles a list of input audio files into one audio file using ffmpeg. The outfile must be OPUS. Returns nothing. Example: await compile([{ start: 3.3/*seconds*/, pan: -1/*from -1 for "all to left" to 1 for "all to right"*/, path: "in1.mp3", duration: 5.6/*seconds*/ }, { start: 0, duration: 8, pan: 0, path: "in2.opus" }], 15.86/*seconds*/, "outfile.opus")
let compile = async (infiles, outduration, outfilepath) => console.log(infiles) || await exec("ffmpeg", [
    "-f", "lavfi",
    "-i", `anullsrc=cl=stereo:sample_rate=48000:d=${outduration}`,
    ...infiles.flatMap(infile => ["-i", infile.path]),
    "-filter_complex", (() => {
        let balanceLeft = n => 1 - Math.max(0, n);
        let outputLabels = [];
        let filterComplex = "";
        infiles.forEach((infile, i) => {
            i += 1;
            let outputLabel = `[processed${i}]`;
            filterComplex += `[${i}]`;
            filterComplex += `adelay=${infile.start}s:all=1`;
            filterComplex += `,pan=stereo|c0=${balanceLeft(infile.pan)}*c0|c1=${balanceLeft(-infile.pan)}*c1`;
            filterComplex += `,atrim=end=${infile.duration}`;
            filterComplex += outputLabel + ";";
            outputLabels.push(outputLabel);
        });
        return filterComplex + `[0]${outputLabels.join("")}amix=inputs=${outputLabels.length + 1}:duration=first[out]`;
    })(),
    "-map", "[out]",
    "-c:a", "libopus",
    "-y",
    outfilepath,
]);

// Gets the duration of the audio file by filepath, in seconds floating point. Can handle OPUS and MP3. Example: await getDuration("a/b/sound.mp3")
let getDuration = async filepath => {
    let durationBuffer = (await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filepath]));
    return parseFloat(durationBuffer.toString("utf-8"));
};

// See the returned closure for the documentation
let makeTextCompleter = (groqSettings) => {
    let groqClient = new Groq({
        apiKey: groqSettings.apiKey,
    });
    // Completes the input messages using a chat-oriented Large Language Model, returns the response of the model as a string. Example: await completer([{ role: "system", content: "Only respond with one number." }, { role: "user", content: "What's 2 + 2?" }, { role: "assistant", content: "4" }, { role: "user", content: "And 5 + 5?" }])
    return async messages => (await groqClient.chat.completions.create({
        messages,
        model: groqSettings.model,
    })).choices[0].message.content;
};

// See the returned closure for the documentation
let makeSoundMaker = (elevenlabsSettings) => {
    let elevenlabsClient = new ElevenLabsClient({
        apiKey: elevenlabsSettings.apiKey,
    });
    // Generates a sound by the provided description and duration, places it into an OPUS file by outfilepath. Example: await soundMaker("A metal pipe falling on the floor", 2/*seconds; may be null*/, "pipe.opus")
    return async (soundDescription, optionalDuration, outfilepath) => {
        let sound = await elevenlabsClient.textToSoundEffects.convert({
            durationSeconds: optionalDuration ?? undefined,
            text: soundDescription,
            promptInfluence: 1,
            outputFormat: "opus_48000_192",
        });
        await fsPromises.writeFile(outfilepath, sound);
    };
};

// See the returned closure for the documentation
let makeVoiceMaker = (speechifySettings) => {
    // Generates a voice by the provided phrase, places it into an MP3 file by outfilepath. Example: await voiceMaker("Hello!", "hello.mp3")
    return async (phrase, outfilepath) => {
        let token1 = (await (await fetch("https://securetoken.googleapis.com/v1/token?key=AIzaSyDbAIg5AN6Cb5kITejfovleb5VDWw0Kv7s", {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: `grant_type=refresh_token&refresh_token=${speechifySettings.refreshToken}`,
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
        let url = (await (await fetch("https://videostudio.api.speechify.com/graphql", {
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
                        voiceId: speechifySettings.voiceId,
                    },
                },
            }),
        })).json()).data.scratchpadPreviewV2.cdnUrl;
        await exec("wget", [url, "-O", outfilepath]);
    };
};

// A helper routine to set up a directory-file tree of the program according to the use of said tree. Example: (await base(".").dir("this", "that")).file("hello.txt")
let base = basePath => ({
    dir: async (...subDirs) => {
        let newPath = path.join(basePath, ...subDirs);
        await fsPromises.mkdir(newPath, { recursive: true });
        return base(newPath);
    },
    file: name => path.join(basePath, name),
});

// A helper routine to match a command, throwing an exception if none of the matchers worked for the command, invoking the respective handler if a matcher did work. Example: await matchCommand(userCommand, [["add number number", async (a, b) => a + b], ["subtract number number", async (a, b) => a - b]]) . Supported types: "number" (-?\d*.?\d+), "rest" (.+). The numbers get automatically converted to type "number"
let matchCommand = async (command, matchers) => {
    for (let matcher of matchers) {
        let [filter, handler] = matcher;
        let [commandName, ...args] = filter.split(" ");
        let argsMatched = args.map(a => ({
            number: {
                regexp: "-?\\d*.?\\d+",
                mapper: a => parseFloat(a),
            },
            rest: {
                regexp: ".+",
                mapper: a => a,
            },
        }[a]));
        let argsString = argsMatched.map(a => `\\s+(${a.regexp})`).join("");
        let match = new RegExp(`^${commandName}${argsString}$`).exec(command);
        if (match != null) {
            let argValuesStrings = match.slice(1);
            let argValues = argValuesStrings.map((a, i) => argsMatched[i].mapper(a));
            return await handler(...argValues);
        }
    }
    throw new Error(`WTF?: ${command}`);
};

// Makes a valid file name from the given string. As unique as a SHA256 hash of the input string. Example: makeFileName("/Hello! :)/")
let makeFileName = string => {
    return string.split("").map(c => {
        let match = /[a-zA-Z0-9]/.exec(c);
        return match == null ? "_" : match[0];
    }).join("") + "_" + crypto.createHash("sha256").update(string).digest("base64url");
};

{
    let config = JSON.parse(await fsPromises.readFile("config.json"));
    let textCompleter = (() => {
        let groqSettings = (() => {
            let groq = config.groq;
            return {
                apiKey: groq.api_key,
                model: groq.model,
            };
        })();
        return makeTextCompleter(groqSettings);
    })();
    let voiceMaker = (() => {
        let speechifySettings = (() => {
            let speechify = config.speechify;
            return {
                refreshToken: speechify.refresh_token,
                voiceId: speechify.voice_id,
            };
        })();
        return makeVoiceMaker(speechifySettings);
    })();
    let soundMaker = (() => {
        let elevenlabsSettings = (() => {
            let elevenlabs = config.elevenlabs;
            return {
                apiKey: elevenlabs.api_key,
            };
        })();
        return makeSoundMaker(elevenlabsSettings);
    })();
    let rundir = await base(".").dir("runs", config.rundir);
    let rawStoryPath = await make(rundir.file("raw_story"), async filepath => {
        await fsPromises.writeFile(filepath, await textCompleter([
            {
                role: "system",
                content: "Please, write out a story as the user requests. The story must be calm and slowly paced, as if the reader is tired. The story should be entirely unidirectional: there must be no interactions from the reader except implied movement (for example, following someone somewhere *per their request*), but no communication from the reader should occur, verbal or non-verbal. You can insert various actions, movement, sounds or other non-verbal details. The story must be very objective, with no descriptions of subjective internal feelings or some abstract descriptions.",
            },
            {
                role: "user",
                content: config.prompt,
            },
        ]));
    });
    let formattedStoryPath = await make(rundir.file("formatted_story"), async filepath => {
        let rawStory = await fsPromises.readFile(rawStoryPath, "utf-8");
        await fsPromises.writeFile(filepath, await textCompleter([
            {
                role: "system",
                content: [
                    "Turn the story sent by the user into a document of the following format: on each line, there should be one of the following commands:",
                    "* voice {panning, from -1 for \"all to left\" to 1 for \"all to right\"} {phrase} - starts a voice saying the phrase from the character, NOT FROM THE NARRATOR (you MUST NOT voice the narrator, everything should be expressed as if it just happens without any narration), MUST be only literal, goes to later commands only after the voice ends",
                    "* sound {panning, from -1 for \"all to left\" to 1 for \"all to right\"} {duration in seconds} {sound description} - starts the specified sound, MUST have a literal description, goes to later commands only after the sound ends",
                    "* bgstart {panning, from -1 for \"all to left\" to 1 for \"all to right\"} {sound description} - starts playing the specified background sound, MUST have a literal description, goes to later commands immediately",
                    "* bgstop {sound description} - stops playing a previously mentioned background sound, goes to later commands immediately",
                    "* wait {time in seconds, floating point} - waits the specified amount of time before going to later commands",
                    "",
                    "EXAMPLE:",
                    "voice 0 now i'm about to go to the left and open the window",
                    "sound -0.5 3 footsteps",
                    "sound -1 1 opening a window",
                    "bgstart -1 sound of rain",
                    "wait 2",
                    "voice -0.8 actually, it's too cold outside, i think it should be closed",
                    "bgstop sound of rain",
                    "sound -1 closing a window",
                ].join("\n"),
            },
            {
                role: "user",
                content: rawStory,
            },
        ]));
    });
    await make(rundir.file("outfile.opus"), async filepath => {
        let sounds = await rundir.dir("sounds");
        let voices = await rundir.dir("voices");
        let formattedStory = await fsPromises.readFile(formattedStoryPath, "utf-8");
        let currentTime = 0;
        let infiles = [];
        let bg = new Map();
        let makeBgHandler = (panning, filepath) => {
            let startTime = currentTime;
            return async () => {
                let oneDuration = await getDuration(filepath);
                let endTime = currentTime;
                let totalDuration = endTime - startTime;
                let infilesShort = [];
                console.log("AAAAAAAAAAAAAAAAAAAAAA", totalDuration, oneDuration);
                new Array(Math.floor(totalDuration / oneDuration)).forEach((_, i) => {
                    infilesShort.push({
                        duration: oneDuration,
                        relativeStart: i * oneDuration,
                    });
                });
                let remainderDuration = totalDuration % oneDuration;
                if (remainderDuration != 0) {
                    infilesShort.push({
                        duration: remainderDuration,
                        relativeStart: infilesShort.length * oneDuration,
                    });
                }
                infiles.push(...infilesShort.map(infileShort => ({
                    path: filepath,
                    pan: panning,
                    start: startTime + infileShort.relativeStart,
                    duration: infileShort.duration,
                })));
            };
        };
        for (let line of formattedStory.trim().split("\n")) {
            await matchCommand(line, [
                ["voice number rest", async (panning, phrase) => {
                    let filepath = await make(voices.file(makeFileName(phrase) + ".mp3"), async filepath => {
                        await voiceMaker(phrase, filepath);
                    });
                    let duration = await getDuration(filepath);
                    infiles.push({
                        path: filepath,
                        duration,
                        start: currentTime,
                        pan: panning,
                    });
                    currentTime += duration;
                }],
                ["sound number number rest", async (panning, duration, soundDescription) => {
                    let filepath = await make(sounds.file(makeFileName(soundDescription) + ".opus"), async filepath => {
                        await soundMaker(soundDescription, duration, filepath);
                    });
                    infiles.push({
                        path: filepath,
                        duration,
                        start: currentTime,
                        pan: panning,
                    });
                    currentTime += duration;
                }],
                ["bgstart number rest", async (panning, soundDescription) => {
                    let filepath = await make(sounds.file(makeFileName(soundDescription) + ".opus"), async filepath => {
                        let duration = null;
                        await soundMaker(soundDescription, duration, filepath);
                    });
                    bg.set(soundDescription, makeBgHandler(panning, filepath));
                }],
                ["bgstop rest", async (soundDescription) => {
                    await bg.get(soundDescription)();
                    bg.delete(soundDescription);
                }],
                ["wait number", async (duration) => {
                    currentTime += duration;
                }],
            ]);
        }
        for (let bgHandler of bg.values()) {
            await bgHandler();
        }
        await compile(infiles, currentTime, filepath);
    });
}
