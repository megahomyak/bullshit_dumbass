import * as fsPromises from "node:fs/promises";
import * as childProcess from "node:child_process";
import * as path from "node:path";

// Works like "GNU make", but only checks for the existence of the file: runs "maker" if the file by filepath doesn't exist. Returns nothing. Example: await make("myfile.txt", async filepath => await fs.writeFile(filepath, "Hello, world!"))
let make = async (filepath, maker) => {
    try {
        await fsPromises.stat(filepath);
    } catch {
        await maker(filepath);
    }
    return filepath;
};

// Executes the provided command with the provided args, throws an error if the execution fails, returns nothing. Example: await exec("ls", ["-l"])
let exec = async (command, args) => new Promise((resolve, reject) => childProcess.spawn(command, args).on("close", code => {
    if (code == 0) { resolve(); }
    else { reject(new Error(`exited with ${code}`)); }
}))

// Compiles a list of input audio files into one audio file using ffmpeg. The outfile must be OPUS. Returns nothing. Example: await compile([{ start: 3.3/*seconds*/, path: "in1.opus", duration: 5.6/*seconds*/ }, { start: 0, path: "in2.opus" }], 15.86/*seconds*/, "outfile.opus")
let compile = async (infiles, outduration, outfilepath) => await exec("ffmpeg", [
    "-f", "lavfi",
    "-i", `anullsrc=cl=stereo:sample_rate=48000:d=${outduration}`,
    ...infiles.flatMap(infile => ["-i", infile.path]),
    "-filter_complex", (
        infiles.map((infile, i) =>
            `[${i}]` +
            `adelay=${infile.start}s:all=1` +
            infile.duration == undefined ? "" : `,atrim=end=${infile.duration}` +
            `[processed${i}];`
        ).join("") +
        `[0]${infiles.map((_, i) => `[processed${i}]`)}amix=inputs=${infiles.length + 1}:duration=first[out]`
    ),
    "-map", "[out]",
    "-c:a", "libopus",
    "-y",
    outfilepath,
]);

// Completes the input messages using a chat-oriented Large Language Model, returns the response of the model as a string. Example: await complete([{ role: "system", content: "Only respond with one number." }, { role: "user", content: "What's 2 + 2?" }, { role: "assistant", content: "4" }, { role: "user", content: "And 5 + 5?" }])
let complete = async messages => {

};

{
    let config = JSON.parse(await fsPromises.readFile("config.json"));
    let makeLocal = async (filepath, maker) => make(path.join("runs", config.rundir, filepath), maker);
    // prompt -> story -> sounds/, voices/ -> outfile.opus
    await makeLocal("prompt", async filepath => {
        await fsPromises.writeFile(filepath, await complete([
            {
                role: "system",
                content: "",
            },
            {
                role: "user",
                content: config.prompt,
            },
        ]));
    });
}
