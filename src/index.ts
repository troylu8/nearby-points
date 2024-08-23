import SQLite3 from "better-sqlite3"

abstract class PointData {

    private _id: string;
    get id() { return this._id; }

    private _x: number;
    get x() { return this._x; }

    private _y: number;
    get y() { return this._y; }

    constructor(x: number, y: number) {
        this._id = crypto.randomUUID();
        this._x = x;
        this._y = y;
    }
}

class PositionalDB<T extends PointData> {

    db: SQLite3.Database;

    private dbvalues: string;
    private props: string[]; 
    private insPlaceHolders: string

    private _blockSize;
    get blockSize() { return this._blockSize; }

    constructor(filename: string, dbvalues: string, blockSize: number = 20) {
        this.db = new SQLite3(filename);
        this.db.pragma('journal_mode = WAL');

        this.dbvalues = dbvalues;

        this.props = dbvalues.split(",").map(s => {
            s = s.trim();
            return s.substring(0, s.indexOf(" "));
        });

        this.insPlaceHolders = this.props.map(() => ", ?").join("");
    
        this._blockSize = blockSize;
    }
    
    private findBlock(x: number, y: number) {
        return [x - x % this.blockSize, y - y % this.blockSize];
    }
    private findTable(x: number, y: number) {
        const block = this.findBlock(x, y);
        return this.posToStr(block[0], block[1]);
    }
    private posToStr(x: number, y: number) {
        return `'x${x}y${y}'`;
    }

    add(data: T) {
        this._add(data, this.findTable(data.x, data.y));
    }
    private _add(data: T, table: string) {
        this.db.prepare(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, x REAL, y REAL, ${this.dbvalues})`).run();

        this.db.prepare(`INSERT INTO ${table} VALUES (?, ?, ?${this.insPlaceHolders})`)
            .run(data.id, data.x, data.y, ...this.props.map(p => (data as any)[p]));
    }

    rem(id: string, x: number, y: number) {
        this._rem(id, this.findTable(x, y));
    }
    private _rem(id: string, table: string) {
        this.db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
        
        const count = (this.db.prepare(`SELECT COUNT(1) FROM ${table}`).get() as any)['COUNT(1)'];
        if (count == 0) this.db.prepare(`DROP TABLE ${table}`).run();
    }

    /**
     * @param data Pointdata object to be moved
     * @param newX 
     * @param newY 
     */
    move(data: T, newX: number, newY: number) {

        const prevTable = this.findTable(data.x, data.y);
        const newTable = this.findTable(newX, newY);

        if (prevTable == newTable) {
            this.db.prepare(`UPDATE ${newTable} SET x=?, y=? WHERE id=?`).run(newX, newY, data.id);
        }
        else {
            const prevData = this.db.prepare(`SELECT * FROM ${prevTable} WHERE id=?`).get(data.id) as T;
            if (!prevData) return;
            
            this._rem(prevData.id, prevTable);
            this._add({...prevData, x: newX, y: newY}, newTable);
        }
    }

    /**
     * 
     * @param data original PointData object 
     * @param fields object with ???
     * 
     * new fields will be merged with original object like so: `{...data, ...fields}`
     */
    edit(data: T, fields: any) {
        if (fields.id != null) throw new Error("cannot edit id");

        const prevTable = this.findTable(data.x, data.y);
        if (null == this.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND tbl_name=${prevTable}`).get())
            return; // data at this position did not exist

        const newTable = (fields.x != null || fields.y != null)? 
            this.findTable(fields.x ?? data.x, fields.y ?? data.y) :
            prevTable;

        this._rem(data.id, prevTable);
        this._add({...data, ...fields}, newTable);
    }

    /**
     * get all points within rectangular area
     * 
     * x and y params refer to the upper left corner of desired area
     * @param x 
     * @param y 
     * @param width 
     * @param height 
     */
    getWithinRect(x: number, y: number, width: number, height: number) : T[] {

        if (width < 0) x += width;
        if (height < 0) y -= height;
        const right = x + Math.abs(width);
        const bottom = y - Math.abs(height);

        const [lowerX, upperY] = this.findBlock(x, y);
        const [upperX, lowerY] = this.findBlock(right, bottom);
        console.log([lowerX, lowerY]);
        console.log([upperX, upperY]);
        const res : T[] = [];

        // these blocks are completely within the rect
        for (let y = lowerY + this.blockSize; y < upperY; y += this.blockSize) {
            for (let x = lowerX + this.blockSize; x < upperX; x += this.blockSize) {
                const table = this.posToStr(x, y);
                console.log(table, " is fully in");

                try { res.push( ...(this.db.prepare(`SELECT * FROM ${table}`).all() as T[]) ); }
                catch (e) {
                    if (!(e instanceof Error) || !e.message.startsWith("no such table")) throw e;
                }
            }
        }

        // points in edge blocks may or may not be within the rect
        function appendPointsWithinRect(db: SQLite3.Database, res: T[], table: string) {
            console.log(table, "is on the edge");
            try { 
                const within = db.prepare(
                    `SELECT * FROM ${table} WHERE ? <= y AND y <= ? AND ? <= x AND x <= ?`
                ).all(bottom, y, x, right) as T[];
                res.push(...within);
            }
            catch (e) {
                if (!(e instanceof Error) || !e.message.startsWith("no such table")) throw e;
            }
        }
        for (let y = lowerY; y <= upperY; y += this.blockSize) {
            
            appendPointsWithinRect(this.db, res, this.posToStr(lowerX, y));
            appendPointsWithinRect(this.db, res, this.posToStr(upperX, y));
        }
        console.log("--");
        for (let x = lowerX + this.blockSize; x < upperX; x += this.blockSize) {
            appendPointsWithinRect(this.db, res, this.posToStr(x, lowerY));
            appendPointsWithinRect(this.db, res, this.posToStr(x, upperY));
        }

        return res;
    }

    /**
     * get all points within circular area
     * @param x 
     * @param y 
     * @param radius 
     */
    getWithinRadius(x: number, y: number, radius: number) : T[] {
        const [upperX, upperY] = this.findBlock(x + radius, y + radius);
        const [lowerX, lowerY] = this.findBlock(x - radius, y - radius);

        const res : T[] = [];

        for (let tableY = lowerY; tableY <= upperY; tableY += this.blockSize ) {
            for (let tableX = lowerX; tableX <= upperX; tableX += this.blockSize) {
                const table = this.posToStr(tableX, tableY);

                try {
                    const nearby = this.db.prepare(
                        `SELECT * FROM ${table} WHERE POW(? - x, 2) + POW(? - y, 2) <= ?`
                    ).all(x, y, radius * radius) as T[];

                    res.push(...nearby);
                }
                catch (e) {
                    if (!(e instanceof Error) || !e.message.startsWith("no such table")) throw e;
                }
                
            }
        }

        return res;
    }

    //TODO: test
    /**
     * get all points
     */
    getAll() {
        const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        const res = [];
        for (const t of tables) res.push( ...this.db.prepare(`SELECT * FROM ${t}`).all() );
        return res as T[];
    }

    /**
     * @param id id of targeted PointData
     * @param x
     * @param y 
     * 
     * optionally add x and y parameters to speed up search.
     * 
     * without them, all tables must be searched
     */
    get(id: string, x?: number, y?: number) {
        if (x != null && y != null) 
            return this.db.prepare(`SELECT * FROM ${this.findTable(x, y)} WHERE id=?`).get(id) as T;
        
        const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        for (const t of tables) {
            const res = this.db.prepare(`SELECT * FROM ${t} WHERE id=?`).get(id) as T;
            if (res != null) return res;
        }
    }
}

export {PositionalDB, PointData};