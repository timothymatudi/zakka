// npm run schema   Prints the Typesense `products` collection schema as JSON.
import { collectionSchema } from '../schema';

console.log(JSON.stringify(collectionSchema(), null, 2));
