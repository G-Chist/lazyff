import type { CommandModule } from "yargs"
import fs from "fs"
import path from "path"
import { runFfmpeg } from "../ffmpeg/index.ts"
import { formatSize } from "../ffmpeg/builder.ts"
import { formatError } from "../ffmpeg/errors.ts"
import { IMAGE_FORMATS, type ImageFormat } from "../ffmpeg/presets.ts"

export interface ImgConvertOptions {
  input: string
  output?: string
  format?: ImageFormat
  quality?: number
  overwrite?: boolean
}

function buildImgConvertArgs(options: ImgConvertOptions): { args: string[]; outputPath: string } {
  const args: string[] = []

  if (options.overwrite) {
    args.push("-y")
  }

  args.push("-hide_banner")
  args.push("-i", options.input)

  const inputExt = path.extname(options.input).slice(1).toLowerCase() as ImageFormat
  const outputFormat = options.format || inputExt
  const formatPreset = IMAGE_FORMATS[outputFormat]

  const ext = formatPreset?.extension || outputFormat
  const dir = path.dirname(options.input)
  const name = path.basename(options.input, path.extname(options.input))
  const outputPath = options.output || path.join(dir, `${name}.${ext}`)

  const outExt = path.extname(outputPath).slice(1).toLowerCase()

  if (outExt === "jpg" || outExt === "jpeg") {
    const q = options.quality !== undefined ? Math.round(31 - (options.quality / 100) * 29) : 2
    args.push("-q:v", String(q))
  } else if (outExt === "png") {
    if (options.quality !== undefined) {
      const level = Math.round((1 - options.quality / 100) * 9)
      args.push("-compression_level", String(level))
    }
  } else if (outExt === "webp") {
    args.push("-quality", String(options.quality ?? 85))
    if (options.quality === 100) {
      args.push("-lossless", "1")
    }
  } else if (outExt === "bmp") {
    // BMP is uncompressed, no quality options
  } else if (outExt === "tiff") {
    args.push("-compression_algo", "deflate")
  }

  args.push(outputPath)

  return { args, outputPath }
}

export const imgConvertCommand: CommandModule = {
  command: "img-convert <input> [output]",
  describe: "Convert images between formats (jpg, png, webp, bmp, tiff)",
  builder: (yargs) => {
    return yargs
      .positional("input", {
        type: "string",
        describe: "Input image path",
        demandOption: true,
      })
      .positional("output", {
        type: "string",
        describe: "Output image path (optional - auto-generated from input name)",
      })
      .option("format", {
        alias: "f",
        type: "string",
        describe: "Output format (jpg, png, webp, bmp, tiff)",
        choices: Object.keys(IMAGE_FORMATS),
      })
      .option("quality", {
        alias: "q",
        type: "number",
        describe: "Quality 1-100 (higher = better, only for lossy formats)",
      })
      .option("overwrite", {
        alias: "y",
        type: "boolean",
        describe: "Overwrite output file if it exists",
        default: false,
      })
      .example([
        ["$0 img-convert photo.png photo.jpg", "Convert PNG to JPEG"],
        ["$0 img-convert photo.jpg --format png", "Convert JPEG to PNG"],
        ["$0 img-convert photo.jpg -f webp -q 80", "Convert to WebP with quality 80"],
        ["$0 img-convert photo.bmp photo.png", "Convert BMP to PNG"],
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

    const options: ImgConvertOptions = {
      input,
      output: argv.output as string | undefined,
      format: argv.format as ImageFormat | undefined,
      quality: argv.quality as number | undefined,
      overwrite: argv.overwrite as boolean,
    }

    const { args, outputPath } = buildImgConvertArgs(options)

    if (fs.existsSync(outputPath) && !options.overwrite) {
      console.error(`\nError: Output file already exists: ${outputPath}`)
      console.error("  → Use --overwrite (-y) to replace it")
      process.exit(1)
    }

    console.log(`Output: ${path.basename(outputPath)}`)
    console.log(`\nConverting image...`)

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

export async function imgConvert(options: ImgConvertOptions): Promise<{
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

  const { args, outputPath } = buildImgConvertArgs(options)

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
