import { type MongoClientOptions as MongoClientOptionsType } from "mongodb";
import { getErrorMap, z } from "zod";

export const MongoClientOptions = z.object({
  replicaSet: z.string(),
  tls: z.boolean(),
  tlsCertificateFile: z.string(),
  tlsCertificateKeyFile: z.string(),
  tlsCertificateKeyFilePassword: z.string(),
  tlsCAFile: z.string(),
  tlsAllowInvalidCertificates: z.boolean(),
  tlsAllowInvalidHostnames: z.boolean(),
  tlsInsecure: z.boolean(),
  connectTimeoutMS: z.number(),
  socketTimeoutMS: z.number(),
  compressors: z.union([
    z.enum(['none', 'snappy', 'zlib', 'zstd']).array(),
    z.string()
  ]),
  zlibCompressionLevel: z.custom<NonNullable<MongoClientOptionsType['zlibCompressionLevel']>>(),
  srvMaxHosts: z.number(),
  srvServiceName: z.string(),
  maxPoolSize: z.number(),
  minPoolSize: z.number(),
  auth: z.object({
    username: z.string().nonempty().optional(),
    password: z.string().nonempty().optional()
  }),
  authSource: z.string(),
  authMechanism: z.custom<MongoClientOptionsType['authMechanism']>(),
  authMechanismProperties: z.record(z.any()),
  serverSelectionTimeoutMS: z.number(),
  heartbeatFrequencyMS: z.number(),
  minHeartbeatFrequencyMS: z.number(),
  appName: z.string(),
  directConnection: z.boolean(),
  loadBalanced: z.boolean()
}).strict().partial();

export const MongoDbConfig = z.object({
  driver: z.literal('mongodb'),
  url: z.string().nonempty(),
  database: z.string().nonempty(),
  connectionOptions: MongoClientOptions.optional(),
  metadataTTL: z.object({
      min: z.number().nonnegative(),
      max: z.number().nonnegative(),
    })
    .refine(({ min, max }) => min <= max, { message: 'Time-To-Live values are invalid, min <= max' })
    .optional()
}).strict();

export const DbConfig = z.discriminatedUnion('driver', [
  MongoDbConfig
], {
  errorMap: (issue, ctx) => ({
    message: issue.code === 'invalid_union_discriminator'
      ? `Unknown driver, valid values are: ${issue.options.join(', ')}`
      : getErrorMap()(issue, ctx).message
  })
});
