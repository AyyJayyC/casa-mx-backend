import compress from "@fastify/compress";
import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";

/**
 * Compress JSON responses above 1 KB. Railway does not compress at the edge,
 * so without this every listing/dashboard payload ships uncompressed.
 */
const compressionPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(compress, {
    global: true,
    threshold: 1024,
  });
};

export default fp(compressionPlugin, { name: "compression" });
