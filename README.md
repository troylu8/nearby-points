# nearby-points
A package for finding data points within a region.

### sample usage
```ts
import { PositionalDB, PointData } from "../src/db";

// create subclass PointData 
class Restaurant extends PointData {
    
    foodCategory: string;
    rating: number;

    constructor(x: number, y: number, foodCategory: string, rating: number) {
        super(x, y);
        
        this.foodCategory = foodCategory;
        this.rating = rating;
    }
}

// initialize db
const foodDB = new PositionalDB("filename.db", 
                                "foodCategory TEXT, rating REAL");

// insert data
foodDB.add(new Restaurant(10, 10, "fried chicken", 3.6));
foodDB.add(new Restaurant(13, 76, "sandwiches", 4.1));
foodDB.add(new Restaurant(90, 45, "smoothies", 4.7));

// find restaurants within 100 units of (50, 50)
const foodNearby = foodDB.getWithinRadius(50, 50, 100);
```

### performance
`nearby-points` is much faster then dumping all points into one SQL table.
However, `.db` files will take more disk space.

**Tests for finding points within `20` units of `(50, 50)`:**
`n` - number of points, randomly generated between `(0,0)` and `(100, 100)`
`plain db` - SQLite3 database where all data points are put into 1 table
`positional db` - SQLite3 database created using `PositionalDB` class
#### speed (ms)
| n            | 100    | 1,000  | 10,000 | 100,000  |
| ------------ | ------ | ------ | ------ | -------- |
|plain db      | 0.1759 | 1.6521 | 12.062 | 147.9294 |
|positional db | 0.2663 | 0.3484 | 2.625  | 17.2353  |

#### disk space (bytes)
| n            | 100  | 1,000  | 10,000  | 100,000  |
| ------------ | ---- | ------ | ------- | -------- |
|plain db      | 4096 | 122880 | 1257472 | 12984320 |
|positional db | 4096 | 208896 | 1515520 | 13004800 |

The code that ran these tests can be found [here](https://github.com/troylu8/nearby-points/blob/master/samples/tests.ts)
