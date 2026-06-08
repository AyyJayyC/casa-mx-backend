export const SecurityHardening = async ({ client }) => {
  await client.app.log({
    body: {
      service: "security-hardening",
      level: "info",
      message: "Security hardening plugin loaded",
    },
  })

  return {
    "tool.execute.before": async (input, output) => {
      // Prevent exposing secrets in bash output
      if (input.tool === "bash") {
        const dangerous = [
          "AWS_SECRET", "STRIPE_SECRET", "JWT_SECRET", "DATABASE_URL",
          "RESEND_API_KEY", "GOOGLE_CLIENT_SECRET", "REDIS_URL",
          "MAPS_API_KEY", "POSTGRES_PASSWORD"
        ]
        for (const secret of dangerous) {
          if (output.args.command?.includes(secret)) {
            throw new Error(`SECURITY: Command references ${secret}. Do not echo/expose secrets.`)
          }
        }
      }

      // Warn about writing to .env files
      if (input.tool === "write" || input.tool === "edit") {
        const fp = output.args?.filePath || ""
        if (fp.includes(".env") && !fp.includes(".example")) {
          throw new Error("SECURITY: Do not write to .env files. Update .env.example instead and instruct the user to update their .env manually.")
        }
      }
    },

    "tool.execute.after": async (input) => {
      // Log tool execution for audit trail
      if (input.tool === "edit" || input.tool === "write") {
        await client.app.log({
          body: {
            service: "security-hardening",
            level: "info",
            message: `File modified: ${input.args?.filePath}`,
            extra: { tool: input.tool, file: input.args?.filePath },
          },
        })
      }
    },

    event: async ({ event }) => {
      if (event.type === "session.error") {
        await client.app.log({
          body: {
            service: "security-hardening",
            level: "error",
            message: "Session error - check if security-related",
            extra: { event },
          },
        })
      }
    },
  }
}
