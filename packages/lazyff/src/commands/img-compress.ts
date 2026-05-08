import type { CommandModule } from "yargs"
import fs from "fs"
import path from "path"
import { runFfmpeg, getMediaInfo } from "../ffmpeg/index.ts"
import { formatSize } from "../ffmpeg/builder.ts"
import { formatError } from "../ffmpeg/errors.ts"
import { IMAGE_QUALITY_PRESETS, type ImageQualityPreset } from "../ffmpeg/presets.ts"

export interface ImgCompressOptions {
  input: string
  output?: string
  quality?: ImageQualityPreset
  qualityValue?: number
  maxSize?: string
  overwrite?: boolean
}

function parseSize(sizeStr: string): number {
  const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB)?$/i)
  if (!match) throw new Error(`Invalid size format: ${sizeStr}`)
  const value = parseFloat(match[1] || "0")
  const unit = (match[2] || "B").toUpperCase()
  const multipliers: Record<string, number> = { B: 1, KB: 1024, MB: 1024 * 1024 }
  return Math.floor(value * (multipliers[unit] || 1))
}

function buildImgCompressArgs(options: ImgCompressOptions): { args: string[]; outputPath: string } {
  const args: string[] = []

  if (options.overwrite) {
    args.push("-y")
  }

  args.push("-hide_banner")
  args.push("-i", options.input)

  const ext = path.extname(options.input).slice(1).toLowerCase()
  const qualityPreset = IMAGE_QUALITY_PRESETS[options.quality || "medium"]

  let quality = options.qualityValue ?? qualityPreset.quality

  if (ext === "jpg" || ext === "jpeg") {
    const q = Math.round(Math.max(1, 31 - (quality / 100) * 30))
    args.push("-q:v", String(q))
  } else if (ext === "png") {
    const level = Math.round((1 - quality / 100) * 9)
    args.push("-compression_level", String(Math.max(1, level)))
  } else if (ext === "webp") {
    args.push("-quality", String(quality))
  }

  const dir = path.dirname(options.input)
  const name = path.basename(options.input, path.extname(options.input))
  const extName = path.extname(options.input)
  const outputPath = options.output || path.join(dir, `${name}_compressed${extName}`)

  args.push(outputPath)

  return { args, outputPath }
}

export const imgCompressCommand: CommandModule = {
  command: "img-compress <input> [output]",
  describe: "Compress/reduce image file size by adjusting quality",
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
      .option("quality", {
        alias: "q",
        type: "string",
        describe: "Quality preset (low, medium, high, lossless)",
        choices: Object.keys(IMAGE_QUALITY_PRESETS),
        default: "medium",
      })
      .option("quality-value", {
        type: "number",
        describe: "Exact quality value 1-100 (overrides --quality preset)",
      })
      .option("max-size", {
        alias: "s",
        type: "string",
        describe: "Target max file size (e.g., 500KB, 1MB) - tries to hit it",
      })
      .option("overwrite", {
        alias: "y",
        type: "boolean",
        describe: "Overwrite output file if it exists",
        default: false,
      })
      .example([
        ["$0 img-compress photo.jpg", "Compress with medium quality preset"],
        ["$0 img-compress photo.jpg -q low", "Compress with low quality (smaller file)"],
        ["$0 img-compress photo.png -q lossless", "Maximum PNG compression (lossless)"],
        ["$0 img-compress photo.jpg --quality-value 50", "Compress with quality 50/100"],
        ["$0 img-compress photo.jpg -s 500KB", "Compress targeting ~500KB file size"],
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

    const options: ImgCompressOptions = {
      input,
      output: argv.output as string | undefined,
      quality: argv.quality as ImageQualityPreset,
      qualityValue: argv["quality-value"] as number | undefined,
      maxSize: argv["max-size"] as string | undefined,
      overwrite: argv.overwrite as boolean,
    }

    const { args, outputPath } = buildImgCompressArgs(options)

    if (fs.existsSync(outputPath) && !options.overwrite) {
      console.error(`\nError: Output file already exists: ${outputPath}`)
      console.error("  → Use --overwrite (-y) to replace it")
      process.exit(1)
    }

    console.log(`Output: ${path.basename(outputPath)}`)
    console.log(`\nCompressing image...`)

    const result = await runFfmpeg(args)

    if (result.exitCode === 0) {
      if (fs.existsSync(outputPath)) {
        const outputStats = fs.statSync(outputPath)
        const sizeChange = ((outputStats.size - inputStats.size) / inputStats.size) * 100
        const sizeChangeStr =
          sizeChange >= 0 ? `+${sizeChange.toFixed(1)}%` : `${sizeChange.toFixed(1)}%`
        const reduction = ((inputStats.size - outputStats.size) / inputStats.size) * 100
        console.log(`\n✓ Done: ${path.basename(outputPath)}`)
        console.log(`        ${formatSize(outputStats.size)} (${sizeChangeStr})`)
        if (reduction > 0) {
          console.log(`        Reduced by ${reduction.toFixed(1)}%`)
        }
      } else {
        console.log(`\n✓ Done: ${outputPath}`)
      }
    } else {
      console.error(`\n${formatError(result.stderr)}`)
      process.exit(1)
    }
  },
}

export async function imgCompress(options: ImgCompressOptions): Promise<{
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

  const { args, outputPath } = buildImgCompressArgs(options)

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
