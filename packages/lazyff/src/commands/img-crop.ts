import type { CommandModule } from "yargs"
import fs from "fs"
import path from "path"
import { runFfmpeg } from "../ffmpeg/index.ts"
import { formatSize } from "../ffmpeg/builder.ts"
import { formatError } from "../ffmpeg/errors.ts"

export interface ImgCropOptions {
  input: string
  output?: string
  width?: number
  height?: number
  x?: number
  y?: number
  aspect?: string
  overwrite?: boolean
}

function buildImgCropArgs(options: ImgCropOptions): { args: string[]; outputPath: string } {
  const args: string[] = []

  if (options.overwrite) {
    args.push("-y")
  }

  args.push("-hide_banner")
  args.push("-i", options.input)

  let cropExpr: string

  if (options.aspect) {
    cropExpr = `crop=${options.aspect}`
  } else if (options.width && options.height) {
    const x = options.x ?? -1
    const y = options.y ?? -1
    cropExpr = `crop=${options.width}:${options.height}:${x}:${y}`
  } else if (options.width) {
    const x = options.x ?? -1
    cropExpr = `crop=${options.width}:in_h:${x}:0`
  } else if (options.height) {
    const y = options.y ?? -1
    cropExpr = `crop=in_w:${options.height}:0:${y}`
  } else {
    cropExpr = "crop=in_w:in_h"
  }

  args.push("-vf", cropExpr)

  const dir = path.dirname(options.input)
  const name = path.basename(options.input, path.extname(options.input))
  const ext = path.extname(options.input)
  const suffix = options.aspect
    ? `_${options.aspect.replace(":", "x")}`
    : options.width && options.height
      ? `_${options.width}x${options.height}`
      : "_cropped"
  const outputPath = options.output || path.join(dir, `${name}${suffix}${ext}`)

  args.push(outputPath)

  return { args, outputPath }
}

export const imgCropCommand: CommandModule = {
  command: "img-crop <input> [output]",
  describe: "Crop images by region or aspect ratio",
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
        describe: "Crop width in pixels",
      })
      .option("height", {
        alias: "h",
        type: "number",
        describe: "Crop height in pixels",
      })
      .option("x", {
        type: "number",
        describe: "X offset in pixels (default: center)",
      })
      .option("y", {
        type: "number",
        describe: "Y offset in pixels (default: center)",
      })
      .option("aspect", {
        alias: "a",
        type: "string",
        describe: "Aspect ratio (e.g., 16:9, 4:3, 1:1)",
      })
      .option("overwrite", {
        alias: "y",
        type: "boolean",
        describe: "Overwrite output file if it exists",
        default: false,
      })
      .check((argv) => {
        if (!argv.width && !argv.height && !argv.aspect) {
          throw new Error("Must specify --width/--height or --aspect")
        }
        return true
      })
      .example([
        ["$0 img-crop photo.jpg -w 800 -h 600", "Crop to 800x600 from center"],
        ["$0 img-crop photo.jpg -w 400 -h 400 -x 0 -y 0", "Crop 400x400 from top-left"],
        ["$0 img-crop photo.jpg -a 1:1", "Crop to square (1:1 aspect ratio)"],
        ["$0 img-crop photo.jpg -a 16:9", "Crop to 16:9 aspect ratio"],
        ["$0 img-crop photo.jpg -w 200 -h 200 -x 100 -y 50", "Crop 200x200 at offset (100,50)"],
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

    const options: ImgCropOptions = {
      input,
      output: argv.output as string | undefined,
      width: argv.width as number | undefined,
      height: argv.height as number | undefined,
      x: argv.x as number | undefined,
      y: argv.y as number | undefined,
      aspect: argv.aspect as string | undefined,
      overwrite: argv.overwrite as boolean,
    }

    const { args, outputPath } = buildImgCropArgs(options)

    if (fs.existsSync(outputPath) && !options.overwrite) {
      console.error(`\nError: Output file already exists: ${outputPath}`)
      console.error("  → Use --overwrite (-y) to replace it")
      process.exit(1)
    }

    console.log(`Output: ${path.basename(outputPath)}`)
    console.log(`\nCropping image...`)

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

export async function imgCrop(options: ImgCropOptions): Promise<{
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

  const { args, outputPath } = buildImgCropArgs(options)

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
