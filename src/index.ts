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

    /**
     * @param data `Pointdata` object to be added
     */
    add(data: T) {
        this._add(data, this.findTable(data.x, data.y));
    }
    private _add(data: T, table: string) {
        this.db.prepare(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, x REAL, y REAL, ${this.dbvalues})`).run();

        this.db.prepare(`INSERT INTO ${table} VALUES (?, ?, ?${this.insPlaceHolders})`)
            .run(data.id, data.x, data.y, ...this.props.map(p => (data as any)[p]));
    }

    /**
     * @param data `Pointdata` object to be removed
     */
    rem(data: T) {
        return this.remWithId(data.id, data.x, data.y);
    }

    /**
     * @param id id of `Pointdata` object to be moved
     * @param x 
     * @param y 
     * 
     * optionally add `x` and `y` parameters to speed up search
     * 
     * without them, all blocks must be searched
     */
    remWithId(id: string, x?: number, y?: number) {
        return this._remWithId(id, this.findTableWithIdOrXY(id, x, y));
    }
    private _remWithId(id: string, table: string) {
        this.db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
        
        const count = (this.db.prepare(`SELECT COUNT(1) FROM ${table}`).get() as any)['COUNT(1)'];
        if (count == 0) this.db.prepare(`DROP TABLE ${table}`).run();
    }

    /**
     * @param data `Pointdata` object to be moved
     * @param newX 
     * @param newY 
     * @returns new data object with new coordinates
     */
    move(data: T, newX: number, newY: number) {
        return this.moveWithId(data.id, newX, newY, data.x, data.y);
    }

    /**
     * @param id id of `Pointdata` object to be moved
     * @param newX 
     * @param newY 
     * @param prevX
     * @param prevY
     * @returns new data object with new coordinates
     * 
     * optionally add `prevX` and `prevY` parameters to speed up search for old object
     * 
     * without them, all blocks must be searched
     */
    moveWithId(id: string, newX: number, newY: number, prevX?: number, prevY?: number) {

        const prevTable = this.findTableWithIdOrXY(id, prevX, prevY);
        const prevData = this.getData(id, prevTable);
        
        const newTable = this.findTable(newX, newY);

        if (prevTable == newTable) {
            this.db.prepare(`UPDATE ${newTable} SET x=?, y=? WHERE id=?`).run(newX, newY, id);
            return this.merge(prevData, {x: newX, y: newY}) as T;
        }
        else {
            this._remWithId(id, prevTable);

            const newData = this.merge(prevData, {x: newX, y: newY}) as T
            this._add(newData, newTable);

            return newData;
        }
    }

    /**
     * 
     * @param data original `PointData` object 
     * @param fields object with new fields to be applied to data
     * @returns new data object with updated fields
     * 
     * new fields will be merged with original object like so: `{...data, ...fields}`
     */
    edit(data: T, fields: any) {
        return this.editWithId(data.id, fields, data.x, data.y);
    }

    /**
     * 
     * @param id id of original `PointData` object 
     * @param fields object with new fields to be applied to data
     * @param x 
     * @param y 
     * @returns new data object with updated fields
     * 
     * new fields will be merged with original object like so: `{...data, ...fields}`
     * 
     * optionally add `x` and `y` parameters to speed up search.
     * 
     * without them, all blocks must be searched
     */
    editWithId(id: string, fields: any, x?: number, y?: number) {
        if (fields.id != null) throw new Error("cannot edit id");

        const prevTable = this.findTableWithIdOrXY(id, x, y);

        const newTable = (fields.x != null || fields.y != null)? 
            this.findTable(fields.x ?? x, fields.y ?? y) :
            prevTable;

        const newData = this.merge(this.getData(id, prevTable), fields);
            
        this._remWithId(id, prevTable);
        this._add(newData, newTable);

        return newData;
    }

    findTablesInRect(x: number, y: number, width: number, height: number) {
        if (width < 0) x += width;
        if (height < 0) y -= height;
        const right = x + Math.abs(width);
        const bottom = y - Math.abs(height);

        const [lowerX, upperY] = this.findBlock(x, y);
        const [upperX, lowerY] = this.findBlock(right, bottom);
        const res : string[] = [];

        for (let y = lowerY; y < upperY; y += this.blockSize) {
            for (let x = lowerX; x < upperX; x += this.blockSize) {
                res.push(this.posToStr(x, y));
            }
        }

        return res;
    }

    findBlock(x: number, y: number) {
        return [x - x % this.blockSize, y - y % this.blockSize];
    }
    findTable(x: number, y: number) {
        const block = this.findBlock(x, y);
        return this.posToStr(block[0], block[1]);
    }
    private posToStr(x: number, y: number) { return `'x${x}y${y}'`; }

    private findTableWithIdOrXY(id: string, x?: number, y?: number) {
        const res = (x == null || y == null)? this.findTableWithId(id) : this.findTable(x, y);
        if (null == this.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND tbl_name=${res}`).get())
            throw new Error(`cannot find data of id ${id}`); 
        return res;
    }

    private findTableWithId(id: string): string {

        const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[];
        for (const t of tables) {
            const res = this.db.prepare(`SELECT * FROM ${t.name} WHERE id=?`).get(id) as T;
            if (res != null) return `'${t.name}'` as string;
        }
        throw new Error(`cannot find id ${id}`);
    }

    private getData(id: string, table: string) {
        const res = this.db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) as T;
        if (!res) throw new Error(`no point found with id ${id}`);
        return res as T;
    }

    private merge(data: T, fields: any) {
        const newData = {
            ...data, 
            id: data.id,
            x: data.x,
            y: data.y,
            ...fields
        };
        delete newData._id;
        delete newData._x;
        delete newData._y;
        return newData;
    }

    /**
     * get all points within a block
     * @param block either a string denoting block name: `'x20y20'` or an array `[x, y]` of coordinates within the desired block: `[20, 20]`
     */
    getWithinBlock(block: string | [number, number]) {
        const table = typeof(block) == "string"? block : this.findTable(block[0], block[1]);

        try { 
            return this.db.prepare(`SELECT * FROM ${table}`).all() as T[]; }
        catch (e) {
            return [];
        } 
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
        const res : T[] = [];

        // these blocks are completely within the rect
        for (let y = lowerY + this.blockSize; y < upperY; y += this.blockSize) {
            for (let x = lowerX + this.blockSize; x < upperX; x += this.blockSize) {
                const table = this.posToStr(x, y);

                try { res.push( ...(this.db.prepare(`SELECT * FROM ${table}`).all() as T[]) ); }
                catch (e) {
                    if (!(e instanceof Error) || !e.message.startsWith("no such table")) throw e;
                }
            }
        }

        // points in edge blocks may or may not be within the rect
        function appendPointsWithinRect(db: SQLite3.Database, res: T[], table: string) {
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

    /**
     * get all points
     */
    getAll() {
        const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[];
        const res = [];
        for (const t of tables) res.push( ...this.db.prepare(`SELECT * FROM ${t.name}`).all() );
        return res as T[];
    }

    /**
     * @param id id of targeted PointData
     * @param x
     * @param y 
     * 
     * optionally add `x` and `y` parameters to speed up search.
     * 
     * without them, all blocks must be searched
     */
    get(id: string, x?: number, y?: number) {
        return this.getData(id, this.findTableWithIdOrXY(id, x, y));
    }
}

export {PositionalDB, PointData};