import { PointData, PositionalDB } from "../src/index.js";
import fs from 'fs';
const perf = require('execution-time')();
import SQLite3 from "better-sqlite3";


function runComparison(n: number) {
    

    // subclassing PointData
    class MyPoint extends PointData {
        str: string
        constructor(x: number, y: number, s: string) {
            super(x, y);
            this.str = s;
        }
    }

    // delete files from previous tests
    try {
        fs.rmSync("pos.db");
        fs.rmSync("plain.db");
    } catch (e) {}

    // initializing positional and plain db
    const posdb = new PositionalDB<MyPoint>("pos.db", "str TEXT"); // using the default blockSize of 20

    const plaindb = new SQLite3("plain.db"); // in plain db, all points are put into one table
    plaindb.pragma('journal_mode = WAL'); // this is called for posdb as well in the PositionalDB constructor
    plaindb.prepare("CREATE TABLE IF NOT EXISTS allpoints (id TEXT PRIMARY KEY, x REAL, y REAL, str TEXT)").run();

    // insert n random points into both db
    for (let i = 0; i < n; i++) {
        const x = Math.random() * 100;
        const y = Math.random() * 100;
        const data = new MyPoint(y, x, "some sample data");
        
        posdb.add(data);
        plaindb.prepare("INSERT INTO allpoints VALUES (?, ?, ?, ?)").run(data.id, data.y, data.x, data.str);
    }


    // we will look for points within this circle
    const circle = {
        x: 50,
        y: 50,
        radius: 20
    }


    // measure speed of plain db
    perf.start();

    const r2 = circle.radius * circle.radius;
    const resultFromPlainDB = [];
    for (const pt of plaindb.prepare("SELECT * FROM allpoints").all() as MyPoint[]) {
        if (Math.pow(pt.y - circle.y, 2) + Math.pow(pt.x - circle.x, 2) < r2) {
            resultFromPlainDB.push(pt);
        }
    }

    const plaindbResults = {
        time: perf.stop().time,
        size: fs.statSync("plain.db").size
    }


    // measure speed of positional db
    perf.start();
    
    const resultFromPosDB = posdb.getWithinRadius(circle.x, circle.y, circle.radius);
    const posdbResults = {
        time: perf.stop().time,
        size: fs.statSync("pos.db").size
    }

    return {
        plainResults: plaindbResults,
        posResults: posdbResults
    }
}

function averageResults(testCount: number, n: number) {
    const results = runComparison(n);
    
    const avgPlain = results.plainResults;
    const avgPos = results.posResults;

    for (let i = 0; i < testCount-1; i++) {
        const results = runComparison(n);
        avgPlain.time += results.plainResults.time;
        avgPos.time += results.posResults.time;
    }

    avgPlain.time /= testCount;
    avgPos.time /= testCount;

    console.log("n: ", n);
    console.log("plain db: ", avgPlain);
    console.log("pos db: ", avgPos);
    console.log();
}

const testCount = 10; // 10 tests for each n are run then averaged
averageResults(testCount, 100);
averageResults(testCount, 1000);
averageResults(testCount, 10000);
averageResults(testCount, 100000);
