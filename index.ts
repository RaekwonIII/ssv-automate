#!/usr/bin/env node
import { Command } from 'commander';

import { spinnerError, stopSpinner } from "./src/spinner";
import { automate } from "./src/commands/ssv-automate";
import { getLidoOperators } from "./src/commands/get-lido-operators";
import { getNewOperators } from "./src/commands/get-new-operators";
import { ping } from "./src/commands/ping-lido-operators"

const program = new Command();
program.argument("<owner>", "the id of the widget")
.description('A simple demonstrative command line tool to obtain SSV cluster data through a Subgraph API')
.version('0.0.1')
.addCommand(getLidoOperators)
.addCommand(getNewOperators)
.addCommand(ping)
.addCommand(automate);

process.on('unhandledRejection', function (err: Error) { // listen for unhandled promise rejections
    const debug = program.opts().verbose; // is the --verbose flag set?
    if(debug) {
        console.error(err.stack); // print the stack trace if we're in verbose mode
    }
    spinnerError() // show an error spinner
    stopSpinner() // stop the spinner
    program.error('', { exitCode: 1 }); // exit with error code 1
})

async function main() {
    await program.parseAsync();

}
console.log() // log a new line so there is a nice space
main();
