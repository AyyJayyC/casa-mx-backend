export const EnvProtection = async () => {
  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool === "read" && output.args.filePath.includes(".env")) {
        throw new Error("SECURITY: Do not read .env files - they contain secrets")
      }
      if (input.tool === "bash") {
        const cmd = output.args.command || ""
        if (/\bcat\s+.*\.env\b/.test(cmd) || /\btype\s+.*\.env\b/.test(cmd)) {
          throw new Error("SECURITY: Do not cat/type .env files")
        }
      }
    },
  }
}
