import { BitField } from "@seamless-medley/utils";
import { ObjectId } from "mongodb";
import { Class } from "type-fest";
import { z } from "zod";

export const MongoDbObjectIdString = z.string().regex(/^([0-9a-zA-Z]{2}){12}$/, 'invalid object id');

export const NonEmptyString = z.string().transform(s => s.trim()).refine(s => s.length, 'Must not be empty');

export const WithId = z.object({
  _id: MongoDbObjectIdString.transform(ObjectId.createFromHexString).readonly()
});

export type WithId = z.infer<typeof WithId>;

// { id: ObjectId => hex string }
export const PlainWithId = z.object({
  _id: z.union([
    z.string(),
    z.instanceof(ObjectId).transform(oid => oid.toHexString())
  ])
});

// { id: ObjectId => hex string, [key]: value }
export const WithPlainId = <T extends z.ZodRawShape>(o: z.ZodObject<T>) => o.merge(PlainWithId);

export const BigIntFlags = (bit: Class<BitField<any>>, def: bigint = 0n) => z.string()
  .transform(s => {
    let n = def;

    try {
      n = s ? BigInt(s) : def;
    }
    catch {}

    return new bit(n);
  })

export const BitFieldString = (bit: Class<BitField<any>>) => z.union([
    z.string(),
    z.instanceof(bit).transform(f => f.valueOf().toString())
  ]);
