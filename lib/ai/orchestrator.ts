import OpenAI from 'openai'
import { callLLMWithTools, callLLM, generateImage } from './openrouter'
import { compileProject, readProjectFile, uploadProjectFile, uploadProjectImage } from '@/lib/latex/compiler'
import { createServiceClient } from '@/lib/supabase/server'
import { renderPdfPages, getPdfPageCount } from '@/lib/latex/pdf-to-image'
import { applyEdits, selfCorrectWithTool } from './latex-edit-tool'
import { sanitizeLatex, validateLatex } from './latex-editor'
import { processImage, processImageRaw, ImageOperation } from '@/lib/images/process'

export interface TaskEvent {
  type: 'status' | 'compile_start' | 'compile_done' | 'compile_error' | 'message' | 'done'
  message?: string
  error?: string
  pdfUrl?: string
}

export interface OrchestratorParams {
  projectId: string
  userMessage: string
  chatHistory: { role: 'user' | 'assistant' | 'system'; content: string }[]
  model?: string
  imageModel?: string
}

// ── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Shluchim Exchange's AI assistant for a Hebrew/English Haggadah book creation platform.

## Context — Chabad Jewish audience
This platform serves Chabad-Lubavitch shluchim (emissaries) and their communities. All content MUST be appropriate for an Orthodox Jewish / Chabad audience:
- The Haggadah is a Jewish Passover text. All imagery and content must reflect Jewish tradition.
- When generating images of people, they should be Jewish (e.g., families at a Seder table, children asking the Four Questions, rabbis, etc.). NEVER generate images of people from other religions or cultures unless specifically requested.
- Use Chabad-appropriate terminology: "Hashem" (not "God"), "Pesach" (not "Passover" in Hebrew contexts), "matzah" (not "bread"), etc.
- Respect halacha: no images mixing meat and dairy, no inappropriate imagery, etc.

You help users edit their LaTeX documents, generate images, and answer questions.

## When to use tools
- For text/layout/color changes: use the search_replace tool
- For creating new images/illustrations: use generate_image, then search_replace to insert it
- For questions or chat: just respond directly (no tools needed)

## LaTeX color syntax — CRITICAL
- NEVER use CSS-style hex colors like \`#2ec993\` in LaTeX. The \`#\` character is invalid in xcolor/TikZ color values and will cause compilation errors.
- To use a hex color inline: \`\\\\textcolor[HTML]{2EC993}{text}\` or \`\\\\fill[fill={rgb,HTML:{2EC993}}]\` — note: NO \`#\`, uppercase hex digits, wrapped in \`[HTML]{...}\`.
- For TikZ fill/draw with hex colors, use: \`\\\\definecolor{mycolor}{HTML}{2EC993}\` in the preamble, then reference by name: \`\\\\fill[fill=mycolor]\`.
- Alternatively use the inline xcolor syntax: \`\\\\color[HTML]{2EC993}\` or \`\\\\textcolor[HTML]{2EC993}{...}\`.
- If the document already defines named colors (e.g. \`sederblue\`, \`sedergold\`), prefer defining a new named color or redefining the existing one rather than using inline hex everywhere.

## search_replace rules
- The search text must be an EXACT substring that appears EXACTLY ONCE in the document.
- Include 5+ lines of surrounding context to ensure uniqueness — more context is always better.
- CRITICAL: The document has section markers like \`%%% ---- COVER PAGE ----\` and \`%%% ---- BACK COVER ----\`. The front and back covers have VERY similar content. ALWAYS include the nearest section marker in your search text. "Cover" or "front cover" = \`%%% ---- COVER PAGE ----\`, NOT the back cover.
- **ONLY change what was requested.** Your replacement text must be IDENTICAL to the search text except for the specific thing being changed. Do NOT modify, rename, remove, or replace \\\\includegraphics commands, image filenames, or any other content that the user did NOT ask you to change. If an \\\\includegraphics line appears in your search context, copy it EXACTLY into the replacement.
- You can call search_replace multiple times for multiple changes.
- Hebrew text is RTL — careful with \\\\beginR, \\\\endR, \\\\texthebrew{}.
- Do not remove \\\\usepackage declarations unless explicitly asked.
- Do NOT reference image filenames that are not already in the document or provided via [Uploaded:] or generate_image. Never invent filenames like "chabad-logo.png" — only use images that exist.

## SCOPE DISCIPLINE — CRITICAL
- ONLY edit the specific page/section the user asked about. If the user says "front cover", ONLY touch content between \`%%% ---- COVER PAGE ----\` and the next \`\\\\clearpage\`.
- NEVER touch other sections "while you're at it" or to "improve" the document.
- Each search_replace call should target ONE section. Your search text must start with or contain the section marker of the page you're editing.
- If you need to make room on a page, only remove/shrink elements ON THAT SAME PAGE. Never modify other pages to compensate.
- After all edits, the ONLY difference between the old and new document should be within the requested section(s). Everything else must be byte-for-byte identical.

## Page overflow awareness — CRITICAL
The document uses a 7×10in page with ~8.2in of usable vertical space. Content MUST NOT spill across page boundaries.

**Space budget — know these approximate sizes:**
- \\\\includegraphics[width=3in]{...} → typically ~3in tall + 20pt padding ≈ 3.3in
- \\\\includegraphics[width=2in]{...} → typically ~2in tall + 20pt padding ≈ 2.3in
- \\\\pgfornament[width=3cm]{...} → ~0.5in tall
- \\\\vspace{Xin} → exactly X inches
- \\\\vspace{Xpt} → X/72 inches
- A TikZ decorative rule/divider → ~0.3–0.5in
- \\\\sedersection{...} header block → ~2in
- \\\\sederdivider → ~0.8in
- A text paragraph → ~0.3–0.5in per paragraph

**When adding ANY element, you MUST make room FIRST:**
1. Identify the page/section you're editing (between its \\\\clearpage or \\\\newpage boundaries)
2. Calculate how much vertical space the new element needs
3. BEFORE inserting, remove or shrink elements on that SAME page to free up at LEAST that much space
4. Only THEN insert the new element

**What to remove/shrink (in order of priority):**
1. \\\\vspace commands — reduce or eliminate them first
2. \\\\pgfornament, decorative TikZ drawings, \\\\bigstar nodes, ornamental dividers
3. Decorative border/frame TikZ code
4. \\\\sederdivider commands
5. Blank lines between elements
6. Font sizes (use \\\\small or \\\\footnotesize to shrink text)
You have FULL PERMISSION to remove ANY decorative element on ANY page. Preserving layout is ALWAYS more important than decorations.

**Hard rules:**
- ALWAYS use a size parameter on \\\\includegraphics: [width=2in] or [width=0.4\\\\textwidth]. Start SMALL (2in) — you can always make it bigger later, but overflow is much harder to fix.
- NEVER allow content to spill onto the next page. If in doubt, remove MORE space than you think you need.
- When inserting between existing elements, you are REPLACING vertical space, not adding to it.
- After making your edits, mentally walk through the page top-to-bottom and estimate total height. If it exceeds ~8in, shrink more.

## generate_image rules
- NEVER use TikZ, pgfplots, or LaTeX drawing commands for illustrations.
- Always use the generate_image tool, then insert with \\\\includegraphics via search_replace.
- Write a detailed, specific prompt describing ONLY the image scene — do NOT include instructions about the document or layout in the image prompt.
- When the image is for a Jewish/Haggadah context, incorporate these details naturally into your prompt where relevant:
  - Matzah should be ROUND hand-made shmurah matzah (never square machine matzah)
  - Maror is romaine lettuce or horseradish (NOT parsley — parsley is karpas, a different item)
  - Boys/men should wear a yarmulke (kippah) and tzitzit
  - Girls/women should wear modest clothing (skirts, not pants)
  - Style should be warm and family-friendly
- Do NOT dump all these guidelines into every prompt — only include what's relevant to the specific image being generated.

## Image processing rules

### imagemagick tool (PREFERRED for any image manipulation)
- Use the **imagemagick** tool to run arbitrary ImageMagick \`convert\` operations on images.
- You write the raw ImageMagick arguments yourself — you have full creative control.
- The tool takes a filename and an array of argument strings that go between the input and output paths.
- Example: to feather edges very slightly: \`["-alpha", "set", "-vignette", "0x3"]\`
- Example: to add a soft 2px Gaussian blur to edges only: \`["-alpha", "set", "(", "+clone", "-channel", "A", "-morphology", "Erode", "Disk:2", "+channel", ")", "-compose", "DstIn", "-composite"]\`
- Example: to convert to grayscale: \`["-colorspace", "Gray"]\`
- Example: to resize to 400px wide: \`["-resize", "400x"]\`
- You can compose ANY valid ImageMagick convert arguments. Use your knowledge of ImageMagick to craft the exact command needed.
- The processed image is saved as a NEW file — update the \\includegraphics reference via search_replace.
- Do NOT process images unless the user asks or it would clearly improve the result.

### process_image tool (LEGACY — simple presets only)
- Use process_image only for simple preset operations (feather, trim, resize, grayscale, sepia, etc.).
- For anything that needs fine control or custom parameters, use the **imagemagick** tool instead.

## File uploads
- \`[Uploaded: filename.png]\` → use exactly: \\\\includegraphics{images/filename.png}
- \`[File: name.txt]...[/File]\` → text file content between the tags

## Undo
- If you realize your edits broke the layout, caused overflow, or modified the wrong sections, call undo_all_changes immediately rather than trying to patch broken edits.
- It's better to undo and start fresh than to make the document worse with attempted fixes.
- If the user says "undo" or "revert", call undo_all_changes.

## Conversation history
- Use chat history to understand follow-up requests like "try again" or "undo that".
- Previous assistant messages may contain \`[Changes applied: ...]\` tags that describe exactly what was changed (generated images, edits made). Use this to know which files exist and what was done before. NEVER overwrite or rename files mentioned in prior changes unless the user explicitly asks.`

// ── Tool definitions ────────────────────────────────────────────────────────

const TOOL_DEFINITIONS: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_replace',
      description:
        'Make a surgical edit to the LaTeX document. The search string must be an exact, unique substring. Include 5+ lines of context and section markers (e.g. %%% ---- COVER PAGE ----) to ensure uniqueness.',
      parameters: {
        type: 'object',
        properties: {
          search: {
            type: 'string',
            description: 'Exact text to find in the document (must appear exactly once)',
          },
          replace: {
            type: 'string',
            description: 'The replacement text',
          },
          reason: {
            type: 'string',
            description: 'Brief explanation of the change',
          },
        },
        required: ['search', 'replace'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_image',
      description:
        'Generate an AI image. Returns the filename. After calling this, use search_replace to insert \\includegraphics{images/FILENAME} at the desired location.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Detailed description of the image to generate',
          },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'process_image',
      description:
        'Process an existing image with ImageMagick operations (feather edges, remove background, trim, shadow, round corners, grayscale, sepia, resize, brightness/contrast). Returns the new filename. Then use search_replace to update the \\includegraphics reference.',
      parameters: {
        type: 'object',
        properties: {
          filename: {
            type: 'string',
            description: 'The image filename to process (e.g. "images/gen-1234.png" or "images/uploaded.png")',
          },
          operations: {
            type: 'array',
            description: 'List of operations to apply in order',
            items: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['feather', 'remove-background', 'trim', 'border', 'shadow', 'round-corners', 'grayscale', 'sepia', 'brightness-contrast', 'resize'],
                  description: 'The operation type',
                },
                radius: { type: 'number', description: 'For feather/round-corners: pixel radius (default 20)' },
                fuzz: { type: 'number', description: 'For remove-background/trim: color tolerance percentage (default 20)' },
                width: { type: 'number', description: 'For resize: target width in pixels. For border: border width in pixels.' },
                height: { type: 'number', description: 'For resize: target height in pixels (optional, maintains aspect ratio if omitted)' },
                color: { type: 'string', description: 'For border: border color (default "white")' },
                opacity: { type: 'number', description: 'For shadow: opacity 0-100 (default 60)' },
                sigma: { type: 'number', description: 'For shadow: blur sigma (default 4)' },
                brightness: { type: 'number', description: 'For brightness-contrast: -100 to 100 (default 0)' },
                contrast: { type: 'number', description: 'For brightness-contrast: -100 to 100 (default 0)' },
              },
              required: ['type'],
            },
          },
        },
        required: ['filename', 'operations'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'imagemagick',
      description:
        'Run arbitrary ImageMagick convert arguments on an image. You compose the exact ImageMagick arguments yourself — full creative control over any image operation. The args array contains everything between the input and output paths (e.g. ["-alpha", "set", "-vignette", "0x3"] for subtle edge feathering). Returns the new filename.',
      parameters: {
        type: 'object',
        properties: {
          filename: {
            type: 'string',
            description: 'The image filename to process (e.g. "images/gen-1234.png" or "images/uploaded.png")',
          },
          args: {
            type: 'array',
            description: 'ImageMagick convert arguments to apply between input and output paths. Each element is one argument token.',
            items: { type: 'string' },
          },
          description: {
            type: 'string',
            description: 'Brief description of what this ImageMagick command does (for the changelog)',
          },
        },
        required: ['filename', 'args'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'undo_all_changes',
      description:
        'Revert ALL changes made in this conversation and restore the document to its state before any edits. Use this if your edits caused problems you cannot fix (overflow, broken layout, content displacement).',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'Why you are undoing (e.g. "edits caused page overflow I cannot fix")',
          },
        },
        required: ['reason'],
      },
    },
  },
]

const MAX_TOOL_ROUNDS = 10

// ── Main orchestrator ───────────────────────────────────────────────────────

export async function* runOrchestrator(
  params: OrchestratorParams
): AsyncGenerator<TaskEvent> {
  const supabase = createServiceClient()

  // Load project
  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', params.projectId)
    .single()

  if (!project) {
    yield { type: 'done', error: 'Project not found' }
    return
  }

  // Always load the document (no intent classification needed)
  yield { type: 'status', message: 'Loading your document...' }

  let doc = await readProjectFile(params.projectId, 'main.tex')

  if (!doc) {
    yield { type: 'done', error: 'No document found. Try creating a new project.' }
    return
  }

  // Migrate old split-file projects
  if (doc.includes('\\input{preamble}') && !doc.includes('\\usepackage')) {
    const assembled = await assembleOldProject(params.projectId, doc)
    if (!assembled) {
      yield { type: 'done', error: 'Could not read project files.' }
      return
    }
    doc = assembled
    await uploadProjectFile(params.projectId, 'main.tex', doc)
  }

  // ── Save pre-edit snapshot for undo ──────────────────────────────────
  await uploadProjectFile(params.projectId, 'snapshots/pre-edit.tex', doc)

  // Build messages for the LLM
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenAI message type union
  const messages: any[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...params.chatHistory.slice(-20).map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    {
      role: 'user',
      content: `## Your LaTeX document:\n\`\`\`latex\n${doc}\n\`\`\`\n\n## Request: ${params.userMessage}`,
    },
  ]

  // ── Tool-calling loop ───────────────────────────────────────────────────

  let currentDoc = doc
  let documentChanged = false
  let aiReply = ''
  // Track changes for the changelog (persisted in chat history for future requests)
  const changeLog: string[] = []

  yield { type: 'status', message: 'Thinking...' }

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await callLLMWithTools(messages, TOOL_DEFINITIONS, {
      model: params.model,
    })

    // No tool calls → final response
    if (!response.tool_calls || response.tool_calls.length === 0) {
      aiReply = response.content || ''
      break
    }

    // Add assistant message (with tool calls) to conversation
    messages.push({
      role: 'assistant',
      content: response.content || null,
      tool_calls: response.tool_calls,
    })

    // Execute each tool call
    for (const tc of response.tool_calls) {
      // We only define function tools, so narrow the type
      const toolCall = tc as OpenAI.ChatCompletionMessageToolCall & { function: { name: string; arguments: string } }
      let toolResult: string

      if (toolCall.function.name === 'search_replace') {
        yield { type: 'status', message: 'Editing your document...' }
        try {
          const args = JSON.parse(toolCall.function.arguments)
          const { result, applied, failed } = applyEdits(currentDoc, [
            { search: args.search, replace: args.replace, reason: args.reason },
          ])

          if (applied.length > 0) {
            currentDoc = result
            documentChanged = true
            toolResult = 'Edit applied successfully.'
            changeLog.push(`edit: ${args.reason || args.replace.slice(0, 80)}`)
          } else {
            toolResult = `Edit FAILED: ${failed[0]?.error}. Try including more surrounding context in your search string, especially section markers like %%% ---- COVER PAGE ----.`
          }
        } catch (err) {
          toolResult = `Edit error: ${err instanceof Error ? err.message : 'Invalid arguments'}`
        }
      } else if (toolCall.function.name === 'generate_image') {
        yield { type: 'status', message: 'Generating an image...' }
        try {
          const args = JSON.parse(toolCall.function.arguments)
          const imageResult = await generateImage(args.prompt, params.imageModel)
          const filename = `gen-${Date.now()}.png`
          const buffer = Buffer.from(imageResult.b64, 'base64')
          await uploadProjectImage(params.projectId, filename, buffer)
          toolResult = `Image generated and saved as images/${filename}. Now use search_replace to insert \\includegraphics[width=3in]{images/${filename}} at the desired location in the document.`
          yield { type: 'message', message: `Image generated: ${filename}` }
          changeLog.push(`generated image: images/${filename}`)
        } catch (err) {
          toolResult = `Image generation failed: ${err instanceof Error ? err.message : 'Unknown error'}. Do NOT use TikZ or drawing commands as a fallback.`
          yield { type: 'message', message: `Image generation failed: ${err instanceof Error ? err.message : 'Unknown error'}` }
        }
      } else if (toolCall.function.name === 'process_image') {
        yield { type: 'status', message: 'Processing image...' }
        try {
          const args = JSON.parse(toolCall.function.arguments)
          const filename = args.filename.replace(/^images\//, '')
          // Download the image from Supabase
          const imgPath = `projects/${params.projectId}/images/${filename}`
          const { data: imgBlob, error: dlError } = await supabase.storage
            .from('projects')
            .download(imgPath)

          if (dlError || !imgBlob) {
            throw new Error(`Could not download image ${filename}: ${dlError?.message ?? 'not found'}`)
          }

          const inputBuffer = Buffer.from(await imgBlob.arrayBuffer())
          const operations: ImageOperation[] = args.operations
          const outputBuffer = await processImage(inputBuffer, operations)

          const newFilename = `proc-${Date.now()}.png`
          await uploadProjectImage(params.projectId, newFilename, outputBuffer)

          const opNames = operations.map((o: ImageOperation) => o.type).join(', ')

          // Visual sanity check: show the AI before/after so it can tell if the processing worked
          const beforeB64 = inputBuffer.toString('base64')
          const afterB64 = outputBuffer.toString('base64')
          const sizeDiff = Math.abs(outputBuffer.length - inputBuffer.length)
          const sizeChanged = sizeDiff > inputBuffer.length * 0.02 // >2% size change

          if (!sizeChanged) {
            console.warn(`[ImageProcess] Output nearly identical to input (${inputBuffer.length} → ${outputBuffer.length} bytes)`)
          }

          toolResult = `Image processed (${opNames}) and saved as images/${newFilename}. Use search_replace to update the \\includegraphics reference from images/${filename} to images/${newFilename}.`

          // Inject a visual review message so the AI can SEE if the processing worked
          // This goes after the tool result and before the next AI turn
          const reviewNote = sizeChanged
            ? 'Look at the BEFORE and AFTER images. Does the processing look correct? If not, try process_image again with different parameters.'
            : 'WARNING: The file sizes are nearly identical — the processing may not have worked. Look carefully at both images. If they look the same, try again with stronger parameters (e.g. higher fuzz for remove-background).'
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResult,
          })
          messages.push({
            role: 'user',
            content: [
              { type: 'text' as const, text: `[System: Image processing review]\n${reviewNote}\n\nBEFORE (${(inputBuffer.length / 1024).toFixed(0)}KB):` },
              { type: 'image_url' as const, image_url: { url: `data:image/png;base64,${beforeB64}` } },
              { type: 'text' as const, text: `AFTER (${(outputBuffer.length / 1024).toFixed(0)}KB):` },
              { type: 'image_url' as const, image_url: { url: `data:image/png;base64,${afterB64}` } },
            ],
          })
          yield { type: 'message', message: `Image processed: ${newFilename}` }
          changeLog.push(`processed image: images/${filename} → images/${newFilename} (${opNames})`)
          // Skip the normal tool result push since we already added it above
          continue
        } catch (err) {
          toolResult = `Image processing failed: ${err instanceof Error ? err.message : 'Unknown error'}`
          yield { type: 'message', message: `Image processing failed: ${err instanceof Error ? err.message : 'Unknown error'}` }
        }
      } else if (toolCall.function.name === 'imagemagick') {
        yield { type: 'status', message: 'Processing image with ImageMagick...' }
        try {
          const args = JSON.parse(toolCall.function.arguments)
          const filename = args.filename.replace(/^images\//, '')
          const imgPath = `projects/${params.projectId}/images/${filename}`
          const { data: imgBlob, error: dlError } = await supabase.storage
            .from('projects')
            .download(imgPath)

          if (dlError || !imgBlob) {
            throw new Error(`Could not download image ${filename}: ${dlError?.message ?? 'not found'}`)
          }

          const inputBuffer = Buffer.from(await imgBlob.arrayBuffer())
          const rawArgs: string[] = args.args
          const outputBuffer = await processImageRaw(inputBuffer, rawArgs)

          const newFilename = `proc-${Date.now()}.png`
          await uploadProjectImage(params.projectId, newFilename, outputBuffer)

          const desc = args.description || rawArgs.join(' ')

          // Visual review — same pattern as process_image
          const beforeB64 = inputBuffer.toString('base64')
          const afterB64 = outputBuffer.toString('base64')
          const sizeDiff = Math.abs(outputBuffer.length - inputBuffer.length)
          const sizeChanged = sizeDiff > inputBuffer.length * 0.02

          if (!sizeChanged) {
            console.warn(`[ImageMagick raw] Output nearly identical to input (${inputBuffer.length} → ${outputBuffer.length} bytes)`)
          }

          toolResult = `Image processed and saved as images/${newFilename}. Use search_replace to update the \\includegraphics reference from images/${filename} to images/${newFilename}.`

          const imReviewNote = sizeChanged
            ? 'Look at the BEFORE and AFTER images. Does the processing look correct? If not, try imagemagick again with different arguments.'
            : 'WARNING: The file sizes are nearly identical — the processing may not have worked. Look carefully at both images. If they look the same, try again with different arguments.'
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResult,
          })
          messages.push({
            role: 'user',
            content: [
              { type: 'text' as const, text: `[System: ImageMagick review]\n${imReviewNote}\n\nBEFORE (${(inputBuffer.length / 1024).toFixed(0)}KB):` },
              { type: 'image_url' as const, image_url: { url: `data:image/png;base64,${beforeB64}` } },
              { type: 'text' as const, text: `AFTER (${(outputBuffer.length / 1024).toFixed(0)}KB):` },
              { type: 'image_url' as const, image_url: { url: `data:image/png;base64,${afterB64}` } },
            ],
          })
          yield { type: 'message', message: `Image processed: ${newFilename}` }
          changeLog.push(`processed image: images/${filename} → images/${newFilename} (${desc})`)
          continue
        } catch (err) {
          toolResult = `ImageMagick failed: ${err instanceof Error ? err.message : 'Unknown error'}. Check your arguments and try again.`
          yield { type: 'message', message: `ImageMagick failed: ${err instanceof Error ? err.message : 'Unknown error'}` }
        }
      } else if (toolCall.function.name === 'undo_all_changes') {
        const args = JSON.parse(toolCall.function.arguments).reason || 'undo requested'
        console.log(`[Orchestrator] AI called undo_all_changes: ${args}`)
        currentDoc = doc
        documentChanged = false
        changeLog.length = 0
        toolResult = 'All changes have been reverted. The document is back to its original state.'
        yield { type: 'message', message: 'Changes undone — document restored to previous version.' }
      } else {
        toolResult = `Unknown tool: ${toolCall.function.name}`
      }

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: toolResult,
      })
    }
  }

  // Fallback reply if the LLM never produced a final text response
  if (!aiReply && documentChanged) {
    aiReply = 'Your changes have been applied.'
  }

  // Show the AI's reply
  if (aiReply) {
    yield { type: 'message', message: aiReply }
  }

  // If no edits were made, just save the reply and done
  if (!documentChanged) {
    await supabase.from('messages').insert({
      project_id: params.projectId,
      role: 'assistant',
      content: aiReply || 'No changes were needed.',
    })
    yield { type: 'done', message: aiReply || 'No changes were needed.' }
    return
  }

  // Sanitize and validate the edited document
  const sanitized = sanitizeLatex(currentDoc)
  const validation = validateLatex(sanitized)

  if (!validation.valid) {
    console.error('[Orchestrator] Edits produced invalid LaTeX:', validation.warnings)
    yield {
      type: 'done',
      error: 'The edits produced invalid LaTeX. Please try a simpler request.',
    }
    return
  }

  currentDoc = sanitized
  console.log(`[Orchestrator] Document changed: ${doc.length} -> ${currentDoc.length} chars`)

  // ── Scope check: log which sections were modified ──────────────────
  try {
    const sectionPattern = /^(%%% ---- .+? ----)/gm
    const getSections = (text: string) => {
      const sections: { name: string; content: string }[] = []
      const markers = Array.from(text.matchAll(sectionPattern))
      for (let i = 0; i < markers.length; i++) {
        const start = markers[i].index!
        const end = i + 1 < markers.length ? markers[i + 1].index! : text.length
        sections.push({ name: markers[i][1], content: text.slice(start, end) })
      }
      return sections
    }
    const beforeSections = getSections(doc)
    const afterSections = getSections(currentDoc)
    const changed: string[] = []
    for (const bs of beforeSections) {
      const as = afterSections.find(s => s.name === bs.name)
      if (!as || as.content !== bs.content) changed.push(bs.name)
    }
    for (const as of afterSections) {
      if (!beforeSections.find(s => s.name === as.name)) changed.push(`NEW: ${as.name}`)
    }
    if (changed.length > 0) {
      console.log(`[Orchestrator] Sections modified: ${changed.join(', ')}`)
    }
  } catch {
    // non-fatal diagnostic
  }

  // Upload modified document
  yield { type: 'status', message: 'Saving changes...' }
  await uploadProjectFile(params.projectId, 'main.tex', currentDoc)

  // ── Capture "before" PDF state for comparison ──────────────────────────
  let beforePageCount = 0
  let beforePages: { page: number; base64: string }[] = []
  try {
    const { data: proj } = await supabase
      .from('projects')
      .select('pdf_path')
      .eq('id', params.projectId)
      .single()

    if (proj?.pdf_path) {
      const { data: pdfBlob } = await supabase.storage
        .from('projects')
        .download(proj.pdf_path)

      if (pdfBlob) {
        const pdfBuf = Buffer.from(await pdfBlob.arrayBuffer())
        beforePageCount = await getPdfPageCount(pdfBuf).catch(() => 0)
        const allPageNums = Array.from({ length: Math.min(beforePageCount || 40, 50) }, (_, i) => i + 1)
        beforePages = await renderPdfPages(pdfBuf, allPageNums, 100)
        console.log(`[Review] Before: ${beforePageCount} pages, captured ${beforePages.length} images`)
      }
    }
  } catch (err) {
    console.warn('[Review] Could not capture before state:', err instanceof Error ? err.message : err)
  }

  // ── Compile → verify → fix loop ──────────────────────────────────────
  // After compile, check page count deterministically. If pages increased,
  // that's overflow — give the fix agent concrete feedback and rendered
  // pages so it can SEE the problem and fix it. Up to 2 fix rounds.

  yield { type: 'compile_start', message: 'Building your book...' }
  await supabase.from('projects').update({ status: 'compiling' }).eq('id', params.projectId)

  let compileSuccess = false
  const maxCompileRetries = 3
  const maxFixRounds = 2

  // ── Phase 1: Compile (with LaTeX error self-correction) ─────────────
  for (let attempt = 1; attempt <= maxCompileRetries; attempt++) {
    const result = await compileProject(params.projectId, currentDoc)

    if (result.success) {
      compileSuccess = true
      break
    }

    const isUploadError = result.errors?.some(e => e.includes('PDF upload failed'))
    if (isUploadError) {
      console.error(`[Orchestrator] PDF upload failed: ${result.errors?.join('; ')}`)
      yield { type: 'compile_error', error: 'The compiled PDF was too large to save.' }
      break
    }

    if (attempt < maxCompileRetries) {
      console.log(`[Orchestrator] Compile attempt ${attempt} failed: ${result.errors?.join('; ')}`)
      yield { type: 'message', message: `Fixing a compile issue (attempt ${attempt}/${maxCompileRetries})...` }
      try {
        currentDoc = await selfCorrectWithTool({
          document: currentDoc,
          errors: result.errors ?? [],
          log: result.log ?? '',
          model: params.model,
        })
        await uploadProjectFile(params.projectId, 'main.tex', currentDoc)
      } catch {
        // Self-correction failed, try compiling again
      }
    } else {
      console.warn(`[Orchestrator] All ${maxCompileRetries} compile attempts failed, reverting`)
      await uploadProjectFile(params.projectId, 'main.tex', doc)
      await supabase.from('projects').update({ status: 'ready' }).eq('id', params.projectId)
      yield {
        type: 'compile_error',
        error: `Compilation failed after ${maxCompileRetries} attempts. Your document has been reverted. Error: ${result.errors?.join('; ')}`,
      }
    }
  }

  // ── Phase 2: Post-compile verification & fix loop ───────────────────
  let reviewNote = ''
  if (compileSuccess) {
    yield { type: 'compile_done', message: 'Your book is ready!' }

    for (let fixRound = 0; fixRound < maxFixRounds; fixRound++) {
      try {
        yield { type: 'status', message: fixRound === 0 ? 'Reviewing the output...' : 'Re-checking after fix...' }

        // ── Step 1: Deterministic page count check ──────────────────
        let afterPageCount = 0
        let afterPdfBuffer: Buffer | null = null
        try {
          const { data: proj } = await supabase
            .from('projects')
            .select('pdf_path')
            .eq('id', params.projectId)
            .single()
          if (proj?.pdf_path) {
            const { data: pdfBlob } = await supabase.storage
              .from('projects')
              .download(proj.pdf_path)
            if (pdfBlob) {
              afterPdfBuffer = Buffer.from(await pdfBlob.arrayBuffer())
              afterPageCount = await getPdfPageCount(afterPdfBuffer).catch(() => 0)
            }
          }
        } catch {
          // non-fatal
        }

        const pageCountChanged = beforePageCount > 0 && afterPageCount > 0 && afterPageCount !== beforePageCount
        if (pageCountChanged) {
          console.warn(`[Review] PAGE COUNT CHANGED: ${beforePageCount} → ${afterPageCount}`)
        }

        // ── Step 2: Only act on deterministic page count check ─────
        // LLM visual reviews produce too many false positives (flagging
        // minor reflow as "content displacement"). Only trigger the fix
        // loop when the page count actually changed — that's a reliable
        // signal of real overflow.
        if (!pageCountChanged) {
          // Run LLM reviews in background for logging only
          Promise.all([
            reviewCompiledPdf({
              projectId: params.projectId,
              userMessage: params.userMessage,
              model: params.model,
              beforePages,
              afterPdfBuffer,
            }).catch(() => null),
            reviewLatexStructure({
              beforeDoc: doc,
              afterDoc: currentDoc,
              userMessage: params.userMessage,
              model: params.model,
            }).catch(() => null),
          ]).then(([pdfReview, structureReview]) => {
            if (pdfReview) console.log(`[Review] Visual (info only): ${pdfReview.slice(0, 200)}`)
            if (structureReview) console.log(`[Review] Structure (info only): ${structureReview.slice(0, 200)}`)
          })
          console.log(`[Review] Page count unchanged (${afterPageCount}), edits accepted`)
          break // All good
        }

        const issues: string[] = [
          `PAGE OVERFLOW DETECTED: Page count changed from ${beforePageCount} to ${afterPageCount}. Content is spilling across page boundaries. You MUST remove spacing, decorations, or shrink elements to fit everything back to ${beforePageCount} pages.`
        ]

        if (false) { // placeholder for future: issues.length === 0
          console.log(`[Review] Round ${fixRound + 1}: All checks passed`)
          break // Everything looks good
        }

        const combinedIssues = issues.join('\n\n')
        console.warn(`[Review] Round ${fixRound + 1} issues: ${combinedIssues}`)
        yield { type: 'status', message: 'Fixing layout issues...' }

        // ── Step 3: Multi-round fix agent with tool loop ────────────
        // Give the fix agent rendered page images so it can SEE the overflow
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fixUserContent: any[] = [
          {
            type: 'text' as const,
            text: `## Your LaTeX document:\n\`\`\`latex\n${currentDoc}\n\`\`\`\n\n## PROBLEMS FOUND — YOU MUST FIX THESE:\nThe previous edit was supposed to: "${params.userMessage}"\n\n${combinedIssues}\n\n## How to fix:\n- Remove \\vspace commands, decorative \\pgfornament, TikZ drawings, \\sederdivider, and other non-essential elements\n- Shrink images: reduce [width=Xin] values\n- Use \\small or \\footnotesize to reduce text size\n- Remove blank lines\n- The goal is to get back to exactly ${beforePageCount} pages. Be aggressive — remove more than you think you need.`,
          },
        ]

        // Attach rendered "after" pages so the fix agent can see the overflow
        if (afterPdfBuffer) {
          try {
            const lastPages = afterPageCount > 0
              ? Array.from({ length: Math.min(afterPageCount, 5) }, (_, i) => afterPageCount - i).reverse()
              : [1]
            const renderedPages = await renderPdfPages(afterPdfBuffer, lastPages, 120)
            for (const rp of renderedPages) {
              fixUserContent.push({
                type: 'text' as const,
                text: `--- Current page ${rp.page} of ${afterPageCount}: ---`,
              })
              fixUserContent.push({
                type: 'image_url' as const,
                image_url: { url: `data:image/png;base64,${rp.base64}` },
              })
            }
          } catch {
            // non-fatal — fix agent can still work from LaTeX alone
          }
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fixMessages: any[] = [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: fixUserContent },
        ]

        // Give the fix agent multiple tool rounds (not just one shot)
        let fixedDoc = currentDoc
        let fixApplied = false
        for (let fixToolRound = 0; fixToolRound < 5; fixToolRound++) {
          const fixResponse = await callLLMWithTools(fixMessages, TOOL_DEFINITIONS, {
            model: params.model,
            toolChoice: fixToolRound === 0 ? 'required' : undefined,
          })

          if (!fixResponse.tool_calls || fixResponse.tool_calls.length === 0) break

          fixMessages.push({
            role: 'assistant',
            content: fixResponse.content || null,
            tool_calls: fixResponse.tool_calls,
          })

          for (const rawTc of fixResponse.tool_calls) {
            const tc = rawTc as OpenAI.ChatCompletionMessageToolCall & { function: { name: string; arguments: string } }
            let toolResult = `Unknown tool: ${tc.function.name}`
            if (tc.function.name === 'search_replace') {
              try {
                const args = JSON.parse(tc.function.arguments)
                const { result, applied, failed } = applyEdits(fixedDoc, [
                  { search: args.search, replace: args.replace },
                ])
                if (applied.length > 0) {
                  fixedDoc = result
                  fixApplied = true
                  toolResult = 'Edit applied successfully.'
                } else {
                  toolResult = `Edit FAILED: ${failed[0]?.error}. Include more context.`
                }
              } catch {
                toolResult = 'Edit error: invalid arguments'
              }
            }
            fixMessages.push({ role: 'tool', tool_call_id: tc.id, content: toolResult })
          }
        }

        if (fixApplied && fixedDoc !== currentDoc) {
          const sanitizedFix = sanitizeLatex(fixedDoc)
          await uploadProjectFile(params.projectId, 'main.tex', sanitizedFix)
          const fixCompile = await compileProject(params.projectId, sanitizedFix)
          if (fixCompile.success) {
            currentDoc = sanitizedFix
            yield { type: 'compile_done', message: 'Fixed and recompiled!' }
            // Loop back to re-verify (next fixRound iteration)
          } else {
            reviewNote = '\n\n' + combinedIssues
            break // Fix compile failed, stop trying
          }
        } else {
          reviewNote = '\n\n' + combinedIssues
          break // No fix could be applied
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[Orchestrator] Review/fix round failed: ${msg}`)
        break
      }
    }
  }

  // ── Auto-revert if fixes failed ──────────────────────────────────────
  // If the review found issues that couldn't be fixed, revert to the
  // pre-edit snapshot rather than leaving a broken document.
  if (reviewNote && compileSuccess) {
    console.warn('[Orchestrator] Fixes failed, reverting to pre-edit snapshot')
    await uploadProjectFile(params.projectId, 'main.tex', doc)
    const revertCompile = await compileProject(params.projectId, doc)
    if (revertCompile.success) {
      currentDoc = doc
      yield { type: 'compile_done', message: 'Reverted to previous version.' }
    }
    reviewNote = '\n\nThe changes caused layout issues that could not be automatically fixed, so the document was reverted to its previous state. Please try a simpler edit.'
  }

  // Save assistant message
  const compileNote = compileSuccess
    ? ''
    : '\n\n(Compilation failed — your document has been reverted to the last working version. Please try a simpler edit.)'
  let finalReply = aiReply || 'Your changes have been applied.'
  if (reviewNote) {
    finalReply = `I attempted the changes, but the visual review found an issue: ${reviewNote.trim()}`
  }

  // Build the saved message: user-visible reply + hidden changelog for future context
  // The changelog is formatted so the AI in future requests knows exactly what was done
  const changeLogSection = changeLog.length > 0
    ? `\n\n[Changes applied: ${changeLog.join('; ')}]`
    : ''
  const summary = finalReply + compileNote + changeLogSection

  await supabase.from('messages').insert({
    project_id: params.projectId,
    role: 'assistant',
    content: summary,
  })

  yield { type: 'done', message: summary }
}

// ── PDF visual review ─────────────────────────────────────────────────────

async function reviewCompiledPdf(params: {
  projectId: string
  userMessage: string
  model?: string
  beforePages?: { page: number; base64: string }[]
  afterPdfBuffer?: Buffer | null
}): Promise<string | null> {
  let pdfBuffer = params.afterPdfBuffer ?? null

  // Download if not provided
  if (!pdfBuffer) {
    const supabase = createServiceClient()
    const { data: project } = await supabase
      .from('projects')
      .select('pdf_path')
      .eq('id', params.projectId)
      .single()
    if (!project?.pdf_path) return null
    const { data: pdfBlob, error } = await supabase.storage
      .from('projects')
      .download(project.pdf_path)
    if (error || !pdfBlob) return null
    pdfBuffer = Buffer.from(await pdfBlob.arrayBuffer())
  }

  let totalPages = 0
  try {
    totalPages = await getPdfPageCount(pdfBuffer)
  } catch {
    totalPages = 40
  }

  // Ask the AI which pages to check
  let pagesToRender: number[]
  try {
    const pagePickResponse = await callLLM(
      [
        {
          role: 'system' as const,
          content: `You pick which PDF pages to visually review after an edit. The PDF has ${totalPages} pages. Return ONLY a JSON array of 5-8 page numbers, e.g. [1, 3, 5, 7, 10]. Always include page 1 and the last page.

IMPORTANT: Include the page that was edited AND its neighboring pages (the page before and after). Content overflow often pushes elements to the NEXT page, so always check adjacent pages.

Common reference: Cover=page 1, TOC~page 3, Kadesh~page 5, Maggid~page 7, Hallel/Nirtzah near end.`,
        },
        {
          role: 'user' as const,
          content: `Edit request: "${params.userMessage}"\nWhich pages should I render? Return ONLY a JSON array.`,
        },
      ],
      { model: params.model, maxTokens: 64, temperature: 0.1 }
    )

    const match = pagePickResponse.match(/\[[\d\s,]+\]/)
    if (match) {
      pagesToRender = JSON.parse(match[0])
        .filter((n: number) => n >= 1 && n <= totalPages)
        .slice(0, 8)
    } else {
      pagesToRender = [1, Math.ceil(totalPages / 2), totalPages]
    }
  } catch {
    pagesToRender = [1, Math.ceil(totalPages / 2), totalPages]
  }

  if (!pagesToRender.includes(1)) pagesToRender.unshift(1)
  pagesToRender = Array.from(new Set(pagesToRender)).sort((a, b) => a - b).slice(0, 8)

  console.log(`[AI Review] PDF has ${totalPages} pages, inspecting: ${pagesToRender.join(', ')}`)

  const afterPages = await renderPdfPages(pdfBuffer, pagesToRender, 150)
  if (afterPages.length === 0) return null

  // Build image content: interleave before/after for each page if we have before pages
  const hasBeforePages = params.beforePages && params.beforePages.length > 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const imageContent: any[] = []
  const pageDescriptions: string[] = []

  for (const afterPage of afterPages) {
    const beforePage = hasBeforePages
      ? params.beforePages!.find(p => p.page === afterPage.page)
      : null

    if (beforePage) {
      imageContent.push({
        type: 'text' as const,
        text: `--- Page ${afterPage.page} BEFORE edit: ---`,
      })
      imageContent.push({
        type: 'image_url' as const,
        image_url: { url: `data:image/png;base64,${beforePage.base64}` },
      })
      imageContent.push({
        type: 'text' as const,
        text: `--- Page ${afterPage.page} AFTER edit: ---`,
      })
      pageDescriptions.push(`page ${afterPage.page} (before + after)`)
    } else {
      imageContent.push({
        type: 'text' as const,
        text: `--- Page ${afterPage.page} (after edit): ---`,
      })
      pageDescriptions.push(`page ${afterPage.page} (after only)`)
    }

    imageContent.push({
      type: 'image_url' as const,
      image_url: { url: `data:image/png;base64,${afterPage.base64}` },
    })
  }

  const reviewMessages = [
    {
      role: 'system' as const,
      content: `You are the visual QA reviewer for Shluchim Exchange, a Chabad Jewish book platform. You are comparing BEFORE and AFTER versions of PDF pages to verify an edit was applied correctly.

The user asked: "${params.userMessage}"

${hasBeforePages ? 'You will see BEFORE and AFTER images for each page. Compare them carefully.' : 'You will see the current state of the pages.'}

Be strict — check for ALL of these:

**PAGE OVERFLOW / CONTENT DISPLACEMENT (most important check):**
- Compare pages that should NOT have changed. If a page that was NOT part of the edit request looks DIFFERENT in the before vs after, content has been displaced — this is a FAILURE.
- Look at the page AFTER the edited page. If new content appeared there that wasn't there before, content overflowed.
- If the total page count changed (a new blank page appeared at the end), that's overflow.

**EDIT VERIFICATION:**
- ADD IMAGE: Is a new image/illustration ACTUALLY VISIBLE? Not just text.
- CHANGE COLOR: Is the color actually different from the standard blue/gold theme?
- ADD TEXT: Is the new text actually visible?

**CULTURAL APPROPRIATENESS:**
- This serves Chabad-Lubavitch communities. All images must depict Jewish people/scenes.
- Matzah must be ROUND (shmurah matzah), not square.
- Flag any non-Jewish imagery or customs.

**LAYOUT:**
- Check for: garbled Hebrew, overlapping elements, blank pages, text cut off at edges.

If you see a problem, describe it in 1-2 sentences. If everything looks correct, say "Pages look good."`,
    },
    {
      role: 'user' as const,
      content: [
        {
          type: 'text' as const,
          text: `Reviewing ${pageDescriptions.join(', ')}. Compare before/after to verify only the requested changes were made and no content shifted between pages.`,
        },
        ...imageContent,
      ],
    },
  ]

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await callLLM(reviewMessages as any, {
      model: params.model,
      maxTokens: 512,
      temperature: 0.2,
    })
  } catch (err) {
    console.warn('[AI] PDF review failed:', err)
    return null
  }
}

// ── LaTeX structural review ────────────────────────────────────────────────

async function reviewLatexStructure(params: {
  beforeDoc: string
  afterDoc: string
  userMessage: string
  model?: string
}): Promise<string | null> {
  const { beforeDoc, afterDoc, userMessage, model } = params

  // Quick structural checks before calling the LLM
  const beforeSections = (beforeDoc.match(/%%% ----.*?----/g) || [])
  const afterSections = (afterDoc.match(/%%% ----.*?----/g) || [])
  const beforeNewpages = (beforeDoc.match(/\\newpage|\\clearpage|\\cleardoublepage/g) || []).length
  const afterNewpages = (afterDoc.match(/\\newpage|\\clearpage|\\cleardoublepage/g) || []).length

  // Build a diff summary of section markers
  const sectionDiff = beforeSections.length !== afterSections.length
    ? `Section count changed: ${beforeSections.length} → ${afterSections.length}.`
    : ''
  const pageDiff = beforeNewpages !== afterNewpages
    ? `Page break count changed: ${beforeNewpages} → ${afterNewpages}.`
    : ''

  const reviewMessages = [
    {
      role: 'system' as const,
      content: `You are a LaTeX structural reviewer for Shluchim Exchange, a Chabad Jewish book platform. You compare BEFORE and AFTER versions of a LaTeX document to catch structural problems that a visual review might miss.

The user asked: "${userMessage}"

Check for ALL of these:

**PAGE OVERFLOW / CONTENT DISPLACEMENT (most critical):**
- Compare the section markers (%%% ---- ... ----) in both versions. Are they the same?
- Count \\newpage / \\clearpage commands. If the AFTER has MORE, content likely overflowed.
- Look at sections that should NOT have changed. If content appeared or disappeared in untouched sections, that's displacement.
${sectionDiff ? `DETECTED: ${sectionDiff}` : ''}
${pageDiff ? `DETECTED: ${pageDiff}` : ''}

**STRUCTURAL INTEGRITY:**
- Are all \\begin{...} matched with \\end{...}?
- Are section markers intact and not duplicated?
- Is \\begin{document} and \\end{document} present exactly once?

**IMAGE REFERENCES:**
- Does every \\includegraphics reference a plausible filename (not invented)?
- Are image size parameters present (e.g., [width=...])? Missing sizes cause overflow.

If you find a problem, describe it concisely (1-2 sentences). If the structure looks correct, say "Pages look good."`,
    },
    {
      role: 'user' as const,
      content: `## BEFORE document (${beforeDoc.length} chars):\n\`\`\`latex\n${beforeDoc.slice(0, 12000)}\n\`\`\`\n\n## AFTER document (${afterDoc.length} chars):\n\`\`\`latex\n${afterDoc.slice(0, 12000)}\n\`\`\`\n\nCompare the two and report any structural issues.`,
    },
  ]

  try {
    return await callLLM(reviewMessages, {
      model,
      maxTokens: 512,
      temperature: 0.2,
    })
  } catch (err) {
    console.warn('[AI] Structure review failed:', err)
    return null
  }
}

// ── Migration helper for old split-file projects ──────────────────────────

async function assembleOldProject(projectId: string, mainTex: string): Promise<string | null> {
  const preamble = await readProjectFile(projectId, 'preamble.tex')
  if (!preamble) return null

  const pagePattern = /\\input\{pages\/(page-\d+)\}/g
  const pageFiles: string[] = []
  let match
  while ((match = pagePattern.exec(mainTex)) !== null) {
    pageFiles.push(match[1])
  }

  const pageContents: string[] = []
  for (const pageFile of pageFiles) {
    const content = await readProjectFile(projectId, `pages/${pageFile}.tex`)
    if (content) pageContents.push(content)
  }

  return `\\documentclass[11pt, openany]{book}

${preamble}

\\begin{document}

${pageContents.join('\n\n')}

\\end{document}
`
}
