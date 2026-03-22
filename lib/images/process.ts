import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'

export type ImageOperation =
  | { type: 'feather'; radius?: number }
  | { type: 'remove-background'; fuzz?: number }
  | { type: 'resize'; width: number; height?: number }
  | { type: 'trim'; fuzz?: number }
  | { type: 'border'; color?: string; width?: number }
  | { type: 'shadow'; opacity?: number; sigma?: number }
  | { type: 'brightness-contrast'; brightness?: number; contrast?: number }
  | { type: 'round-corners'; radius?: number }
  | { type: 'grayscale' }
  | { type: 'sepia' }

/**
 * Process an image buffer through one or more ImageMagick operations.
 * Returns the processed image as a PNG buffer.
 */
export async function processImage(
  inputBuffer: Buffer,
  operations: ImageOperation[]
): Promise<Buffer> {
  const tmpDir = path.join(os.tmpdir(), `alefbook-imgproc-${Date.now()}`)
  await fs.mkdir(tmpDir, { recursive: true })

  const inputPath = path.join(tmpDir, 'input.png')
  const outputPath = path.join(tmpDir, 'output.png')

  try {
    await fs.writeFile(inputPath, inputBuffer)

    const args = buildConvertArgs(inputPath, outputPath, operations)
    console.log(`[ImageProcess] Running: magick ${args.join(' ')}`)

    await runConvert(args)

    return await fs.readFile(outputPath)
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

function buildConvertArgs(
  inputPath: string,
  outputPath: string,
  operations: ImageOperation[]
): string[] {
  const args: string[] = [inputPath]

  for (const op of operations) {
    switch (op.type) {
      case 'feather': {
        // Fade edges to transparent using an alpha mask with blurred border
        const radius = op.radius ?? 20
        args.push(
          '-alpha', 'set',
          '(', '+clone',
          '-channel', 'A', '-evaluate', 'set', '100%', '+channel',
          '-background', 'none',
          '-vignette', `0x${radius}`,
          ')',
          '-compose', 'DstIn',
          '-composite'
        )
        break
      }

      case 'remove-background': {
        // Make matching background pixels transparent (keep alpha, no flatten)
        const fuzz = op.fuzz ?? 20
        args.push(
          '-fuzz', `${fuzz}%`,
          '-transparent', 'white'
        )
        break
      }

      case 'resize': {
        const geometry = op.height
          ? `${op.width}x${op.height}`
          : `${op.width}x`
        args.push('-resize', geometry)
        break
      }

      case 'trim': {
        const fuzz = op.fuzz ?? 10
        args.push('-fuzz', `${fuzz}%`, '-trim', '+repage')
        break
      }

      case 'border': {
        const color = op.color ?? 'white'
        const width = op.width ?? 10
        args.push(
          '-bordercolor', color,
          '-border', `${width}x${width}`
        )
        break
      }

      case 'shadow': {
        const opacity = op.opacity ?? 60
        const sigma = op.sigma ?? 4
        args.push(
          '(', '+clone',
          '-background', 'black',
          '-shadow', `${opacity}x${sigma}+0+0`,
          ')',
          '+swap',
          '-background', 'white',
          '-layers', 'merge',
          '+repage'
        )
        break
      }

      case 'brightness-contrast': {
        const brightness = op.brightness ?? 0
        const contrast = op.contrast ?? 0
        args.push('-brightness-contrast', `${brightness}x${contrast}`)
        break
      }

      case 'round-corners': {
        // Round corners using an alpha mask (transparent corners)
        const radius = op.radius ?? 20
        args.push(
          '-alpha', 'set',
          '(', '+clone',
          '-alpha', 'transparent',
          '-background', 'white',
          '-draw', `roundrectangle 0,0,%[fx:w-1],%[fx:h-1],${radius},${radius}`,
          ')',
          '-compose', 'DstIn',
          '-composite'
        )
        break
      }

      case 'grayscale':
        args.push('-colorspace', 'Gray')
        break

      case 'sepia':
        args.push('-sepia-tone', '80%')
        break
    }
  }

  args.push(outputPath)
  return args
}

function runConvert(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    // Try 'magick' first (ImageMagick 7), fall back to 'convert' (ImageMagick 6)
    execFile('magick', args, { timeout: 30_000, maxBuffer: 5 * 1024 * 1024 }, (error) => {
      if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        // magick not found, try convert (IM6)
        execFile('convert', args, { timeout: 30_000, maxBuffer: 5 * 1024 * 1024 }, (err) => {
          if (err) reject(new Error(`ImageMagick failed: ${err.message}`))
          else resolve()
        })
      } else if (error) {
        reject(new Error(`ImageMagick failed: ${error.message}`))
      } else {
        resolve()
      }
    })
  })
}
