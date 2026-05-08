import type { CommandModule } from "yargs"
import fs from "fs"
import path from "path"
import { runFfmpeg } from "../ffmpeg/index.ts"
import { formatSize } from "../ffmpeg/builder.ts"
import { formatError } from "../ffmpeg/errors.ts"

export interface ImgScaleOptions {
  input: string
  output?: string
  width?: number
  height?: number
  percent?: number
  fit?: "contain" | "cover" | "fill" | "pad"
  overwrite?: boolean
}

function buildImgScaleArgs(options: ImgScaleOptions): { args: string[]; outputPath: string } {
  const args: string[] = []

  if (options.overwrite) {
    args.push("-y")
  }

  args.push("-hide_banner")
  args.push("-i", options.input)

  let scaleExpr: string

  if (options.percent) {
    const pct = options.percent / 100
    scaleExpr = `iw*${pct}:ih*${pct}`
  } else if (options.width && options.height) {
    if (options.fit === "contain") {
      scaleExpr = `min(${options.width},iw):min(${options.height},ih):force_original_aspect_ratio=decrease`
    } else if (options.fit === "cover") {
      scaleExpr = `max(${options.width},iw):max(${options.height},ih):force_original_aspect_ratio=increase`
    } else if (options.fit === "pad") {
      scaleExpr = `${options.width}:${options.height}:force_original_aspect_ratio=decrease,pad=${options.width}:${options.height}:(ow-iw)/2:(oh-ih)/2`
    } else {
      scaleExpr = `${options.width}:${options.height}`
    }
  } else if (options.width) {
    scaleExpr = `${options.width}:-2`
  } else if (options.height) {
    scaleExpr = `-2:${options.height}`
  } else {
    scaleExpr = "iw:ih"
  }

  args.push("-vf", `scale=${scaleExpr}`)

  const dir = path.dirname(options.input)
  const name = path.basename(options.input, path.extname(options.input))
  const ext = path.extname(options.input)
  const suffix = options.percent
    ? `_${options.percent}pct`
    : options.width && options.height
      ? `_${options.width}x${options.height}`
      : options.width
        ? `_w${options.width}`
        : options.height
          ? `_h${options.height}`
          : "_scaled"
  const outputPath = options.output || path.join(dir, `${name}${suffix}${ext}`)

  args.push(outputPath)

  return { args, outputPath }
}

export const imgScaleCommand: CommandModule = {
  command: "img-scale <input> [output]",
  describe: "Scale/resize images by dimensions or percentage",
  builder: (yargs) => {
    return yargs
      .positional("input", {
        type: "string",
        describe: "Input image path",
        demandOption: true,
      })
      .positional("output", {
        type: "string",
        describe: "Output image path (optional - auto-generated)",
      })
      .option("width", {
        alias: "w",
        type: "number",
        describe: "Output width in pixels (height auto-calculated)",
      })
      .option("height", {
        alias: "h",
        type: "number",
        describe: "Output height in pixels (width auto-calculated)",
      })
      .option("percent", {
        alias: "p",
        type: "number",
        describe: "Scale by percentage (e.g., 50 for half, 200 for double)",
      })
      .option("fit", {
        type: "string",
        describe: "Fit mode when both width and height are given",
        choices: ["contain", "cover", "fill", "pad"] as const,
        default: "fill",
      })
      .option("overwrite", {
        alias: "y",
        type: "boolean",
        describe: "Overwrite output file if it exists",
        default: false,
      })
      .check((argv) => {
        const targets = [argv.width, argv.height, argv.percent].filter((v) => v !== undefined)
        if (targets.length === 0) {
          throw new Error("Must specify at least one of: --width, --height, or --percent")
        }
        if (argv.percent !== undefined && (argv.width !== undefined || argv.height !== undefined)) {
          throw new Error("Cannot combine --percent with --width or --height")
        }
        return true
      })
      .example([
        ["$0 img-scale photo.jpg -w 800", "Scale to 800px wide (auto height)"],
        ["$0 img-scale photo.jpg -w 1920 -h 1080", "Scale to exact 1920x1080"],
        ["$0 img-scale photo.jpg -p 50", "Scale to 50% of original"],
        ["$0 img-scale photo.jpg -w 800 --fit contain", "Scale to fit within 800px box"],
        ["$0 img-scale photo.jpg -w 200 -h 200 --fit cover", "Crop-cover to 200x200"],
      ])
  },
  handler: async (argv) => {
    const input = argv.input as string

    if (!fs.existsSync(input)) {
      console.error(`\nError: File not found: ${input}`)
      console.error("  → Check if the file path is correct")
      process.exit(1)
    }

    console.log("")
    const inputStats = fs.statSync(input)
    console.log(`Input:  ${path.basename(input)}`)
    console.log(`        ${formatSize(inputStats.size)}`)

    const options: ImgScaleOptions = {
      input,
      output: argv.output as string | undefined,
      width: argv.width as number | undefined,
      height: argv.height as number | undefined,
      percent: argv.percent as number | undefined,
      fit: argv.fit as ImgScaleOptions["fit"],
      overwrite: argv.overwrite as boolean,
    }

    const { args, outputPath } = buildImgScaleArgs(options)

    if (fs.existsSync(outputPath) && !options.overwrite) {
      console.error(`\nError: Output file already exists: ${outputPath}`)
      console.error("  → Use --overwrite (-y) to replace it")
      process.exit(1)
    }

    console.log(`Output: ${path.basename(outputPath)}`)
    console.log(`\nScaling image...`)

    const result = await runFfmpeg(args)

    if (result.exitCode === 0) {
      if (fs.existsSync(outputPath)) {
        const outputStats = fs.statSync(outputPath)
        const sizeChange = ((outputStats.size - inputStats.size) / inputStats.size) * 100
        const sizeChangeStr =
          sizeChange >= 0 ? `+${sizeChange.toFixed(1)}%` : `${sizeChange.toFixed(1)}%`
        console.log(`\n✓ Done: ${path.basename(outputPath)}`)
        console.log(`        ${formatSize(outputStats.size)} (${sizeChangeStr})`)
      } else {
        console.log(`\n✓ Done: ${outputPath}`)
      }
    } else {
      console.error(`\n${formatError(result.stderr)}`)
      process.exit(1)
    }
  },
}

export async function imgScale(options: ImgScaleOptions): Promise<{
  success: boolean
  outputPath: string
  error?: string
}> {
  if (!fs.existsSync(options.input)) {
    return {
      success: false,
      outputPath: "",
      error: `File not found: ${options.input}`,
    }
  }

  const { args, outputPath } = buildImgScaleArgs(options)

  if (fs.existsSync(outputPath) && !options.overwrite) {
    return {
      success: false,
      outputPath,
      error: "Output file already exists. Set overwrite: true to replace it.",
    }
  }

  const result = await runFfmpeg(args)

  if (result.exitCode === 0) {
    return { success: true, outputPath }
  } else {
    return {
      success: false,
      outputPath,
      error: formatError(result.stderr),
    }
  }
}
