import * as fsPromises from "node:fs/promises";
import * as childProcess from "node:child_process";
import * as path from "node:path";
import Groq from "groq-sdk";

// Works like "GNU make", but only checks for the existence of the file: runs "maker" if the file by filepath doesn't exist. Returns nothing. Example: await make("myfile.txt", async filepath => await fs.writeFile(filepath, "Hello, world!"))
let make = async (filepath, maker) => {
    try {
        await fsPromises.stat(filepath);
    } catch {
        await maker(filepath);
    }
    return filepath;
};

// Executes the provided command with the provided args, throws an error if the execution fails, returns the contents of the standard output as a Buffer. Example: await exec("ls", ["-l"])
let exec = async (command, args) => new Promise((resolve, reject) => {
    let process = childProcess.spawn(command, args);
    let stdout = new Buffer();
    process.stdout.on("data", data => stdout += data);
    process.on("close", code => {
        if (code == 0) { resolve(stdout); }
        else { reject(new Error(`exited with ${code}`)); }
    });
});

// Compiles a list of input audio files into one audio file using ffmpeg. The outfile must be OPUS. Returns nothing. Example: await compile([{ start: 3.3/*seconds*/, path: "in1.mp3", duration: 5.6/*seconds*/ }, { start: 0, path: "in2.opus" }], 15.86/*seconds*/, "outfile.opus")
let compile = async (infiles, outduration, outfilepath) => await exec("ffmpeg", [
    "-f", "lavfi",
    "-i", `anullsrc=cl=stereo:sample_rate=48000:d=${outduration}`,
    ...infiles.flatMap(infile => ["-i", infile.path]),
    "-filter_complex", (() => {
        let balanceLeft = n => 1 - Math.max(0, n);
        let outputLabels = "";
        let filterComplex = "";
        infiles.forEach((infile, i) => {
            let outputLabel = `[processed${i}]`;
            filterComplex += `[${i}]`;
            filterComplex += `adelay=${infile.start}s:all=1`;
            filterComplex += `,pan=stereo|c0=${balanceLeft(infile.pan)}*c0|c1=${balanceLeft(-infile.pan)}*c1`;
            if (infile.duration != undefined) {
                filterComplex += `,atrim=end=${infile.duration}`;
            }
            filterComplex += outputLabel + ";";
            outputLabels += outputLabel;
        });
        return filterComplex + `${outputLabels}amix=inputs=${outputLabels.length + 1}:duration=first[out]`;
    })(),
    "-map", "[out]",
    "-c:a", "libopus",
    "-y",
    outfilepath,
]);

let getDuration = async filepath => {
    let durationBuffer = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filepath]);
    return parseFloat(durationBuffer.toString("utf-8"));
};

let makeCompleter = (groqSettings) => {
    let groqClient = new Groq({
        apiKey: groqSettings.apiKey,
    });
    // Completes the input messages using a chat-oriented Large Language Model, returns the response of the model as a string. Example: await complete([{ role: "system", content: "Only respond with one number." }, { role: "user", content: "What's 2 + 2?" }, { role: "assistant", content: "4" }, { role: "user", content: "And 5 + 5?" }])
    return async messages => await groqClient.chat.completions.create({
        messages,
        model: groqSettings.model,
    });
};

let base = basePath => ({
    dir: async (...subDirs) => {
        let newPath = path.join(basePath, ...subDirs);
        await fsPromises.mkdir(newPath, { recursive: true });
        return base(newPath);
    },
    file: name => path.join(basePath, name),
});

{
    let config = JSON.parse(await fsPromises.readFile("config.json"));
    let groqSettings = {
        apiKey: config.api_key,
        model: config.model,
    };
    let completer = makeCompleter(groqSettings);
    let rundir = await base(".").dir("runs", config.rundir);
    let rawStoryPath = await make(rundir.file("raw_story"), async filepath => {
        await fsPromises.writeFile(filepath, await completer([
            {
                role: "system",
                content: "Please, write out a story as the user requests. The story must be calm and slowly paced, as if the reader is tired. The story should be entirely unidirectional: there must be no interactions from the reader except implied movement (for example, following someone somewhere *per their request*), but no communication from the reader should occur, verbal or non-verbal. You can insert various actions, movement, sounds or other non-verbal details.",
            },
            {
                role: "user",
                content: config.prompt,
            },
        ]));
    });
    let formattedStoryPath = await make(rundir.file("formatted_story"), async filepath => {
        let rawStory = await fsPromises.readFile(rawStoryPath, "utf-8");
        await fsPromises.writeFile(filepath, await completer([
            {
                role: "system",
                content: [
                    "Turn the story sent by the user into a document of the following format: on each line, there should be one of the following commands:",
                    "* voice {panning, from -1 for all-left to 1 for all-right} {phrase} - starts a voice from the character, goes to later commands only after the voice ends",
                    "* sound {panning, from -1 for all-left to 1 for all-right} {duration in seconds} {sound description} - starts a sound, goes to later commands only after the sound ends",
                    "* bgstart {panning, from -1 for all-left to 1 for all-right} {sound description} - starts playing a background sound, goes to later commands immediately",
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
        for (let line of formattedStory.trim().split("\n")) {
            let match = (commandName, args, handler) => command => {
                let match = new RegExp(`^${commandName}${args.map(a => `\\s+(${a})`)}$`).exec(command);
                return match == null ? null : async () => await handler(...match.slice(1));
            };
            let rest = ".+";
            let number = "\\d*.?\\d+";
            let filters = [
                match("voice", [number, rest], async (panning, phrase) => {

                }),
                match("sound", [number, number, rest], async (panning, duration, soundDescription) => {

                }),
                match("bgstart", [number, rest], async (panning, soundDescription) => {

                }),
                match("bgstop", [rest], async (soundDescription) => {

                }),
                match("wait", [number], async (duration) => {

                }),
            ];
            let filters = [
                [/^sound\s+(?<durationSeconds>\d*.?\d+)\s+(?<soundDescription>.+)$/, async groups => {
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
        }
    });
}
