import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Progress } from "@/components/ui/progress"
import { Alert, AlertDescription } from "@/components/ui/alert"

type WorkspaceFile = {
  file_id: string
  name: string
  mime_type: string
  modified_time: string | null
  supported: boolean    // new field
  extracted: boolean
  extract_error: string
  summarized: boolean
  char_count: number
  truncated: boolean
}

type WorkspaceFolder = {
  folder_path: string
  files: WorkspaceFile[]
  summary: string
  summary_file_count: number
  summarized_file_count: number
  total_file_count: number
  supported_file_count: number
  needs_resummary: boolean
}

type Totals = {
  files: number
  extracted: number
  summarized: number
  folders: number
  folder_summaries: number
}

type ProcessStage = "idle" | "extracting" | "summarizing" | "folder-summarizing" | "done" | "error"

type Props = {
  refreshTrigger: number
  onRemoveFile: (file_id: string) => Promise<void>
  onClearAll: () => Promise<void>
}

export function Workspace({ refreshTrigger, onRemoveFile, onClearAll }: Props) {
  const [folders, setFolders] = useState<WorkspaceFolder[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [stage, setStage] = useState<ProcessStage>("idle")
  const [stageMessage, setStageMessage] = useState<string>("")
  const [errorMessage, setErrorMessage] = useState<string>("")

  const refresh = useCallback(async () => {
    const r = await fetch("http://localhost:8000/api/chat/workspace/grouped")
    const d = await r.json()
    setFolders(d.folders ?? [])
    setTotals(d.totals ?? null)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh, refreshTrigger])

  const runProcess = async () => {
    setErrorMessage("")
    try {
      setStage("extracting")
      setStageMessage("Downloading and extracting text from Drive...")
      const r1 = await fetch("http://localhost:8000/api/chat/process/extract", { method: "POST" })
      if (!r1.ok) throw new Error(`Extract failed: ${r1.status}`)
      await refresh()

      setStage("summarizing")
      setStageMessage("Generating per-file summaries with Gemma...")
      const r2 = await fetch("http://localhost:8000/api/chat/process/summarize", { method: "POST" })
      if (!r2.ok) throw new Error(`Summarize failed: ${r2.status}`)
      await refresh()

      setStage("folder-summarizing")
      setStageMessage("Rolling up folder summaries...")
      const r3 = await fetch("http://localhost:8000/api/chat/process/folder-summaries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      })
      if (!r3.ok) throw new Error(`Folder summaries failed: ${r3.status}`)
      await refresh()

      setStage("done")
      setStageMessage("All set.")
    } catch (e) {
      setStage("error")
      setErrorMessage(e instanceof Error ? e.message : "Unknown error")
    }
  }

  const processing = stage === "extracting" || stage === "summarizing" || stage === "folder-summarizing"
  const progressValue = (() => {
    if (stage === "extracting") return 25
    if (stage === "summarizing") return 60
    if (stage === "folder-summarizing") return 90
    if (stage === "done") return 100
    return 0
  })()

  const needsProcessing = totals && (
    totals.extracted < totals.files ||
    totals.summarized < totals.extracted ||
    totals.folder_summaries < totals.folders
  )

  return (
    <div className="space-y-4">
      {/* Stats + Process button */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-2 flex-wrap text-sm">
          {totals && (
            <>
              <Badge variant="outline">{totals.files} files</Badge>
              <Badge variant="outline">{totals.folders} folders</Badge>
              <Badge variant={totals.extracted === totals.files ? "default" : "secondary"}>
                {totals.extracted}/{totals.files} extracted
              </Badge>
              <Badge variant={totals.summarized === totals.extracted ? "default" : "secondary"}>
                {totals.summarized}/{totals.extracted} summarized
              </Badge>
            </>
          )}
        </div>
        <div className="flex gap-2">
          {totals && totals.files > 0 && (
            <Button onClick={runProcess} disabled={processing || !needsProcessing}>
              {processing
                ? "Processing..."
                : needsProcessing
                ? "Process workspace"
                : "All processed"}
            </Button>
          )}
          {totals && totals.files > 0 && (
            <Button variant="outline" onClick={onClearAll} disabled={processing}>
              Clear all
            </Button>
          )}
        </div>
      </div>

      {/* Progress + status messaging */}
      {processing && (
        <div className="space-y-2">
          <Progress value={progressValue} />
          <p className="text-sm text-muted-foreground">{stageMessage}</p>
        </div>
      )}
      {stage === "done" && (
        <Alert>
          <AlertDescription>Processing complete. You can now ask questions in the chat panel.</AlertDescription>
        </Alert>
      )}
      {stage === "error" && (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      {/* Folders grouped */}
      {folders.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No files yet. Browse and add some on the left.
        </p>
      ) : (
        <Accordion type="multiple" className="w-full">
          {folders.map((folder) => (
            <AccordionItem key={folder.folder_path} value={folder.folder_path}>
                <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-start justify-between w-full pr-3 gap-3">
                    <span className="font-medium text-left break-words pr-2 leading-snug">
                        📁 {folder.folder_path}
                        </span>
                    <div className="flex gap-1.5 items-center">
                        <Badge variant="secondary">{folder.files.length}</Badge>
                        {folder.supported_file_count === 0 ? (
                            <Badge variant="outline" className="text-xs text-muted-foreground" title="No supported file types in this folder">
                            no text content
                            </Badge>
                        ) : folder.summary && !folder.needs_resummary ? (
                            folder.summarized_file_count < folder.supported_file_count ? (
                            <Badge
                                variant="outline"
                                className="text-xs"
                                title={`Summary covers ${folder.summarized_file_count} of ${folder.supported_file_count} supported files`}
                            >
                                partial
                            </Badge>
                            ) : (
                            <Badge variant="default" className="text-xs">summarized</Badge>
                            )
                        ) : folder.needs_resummary ? (
                            <Badge variant="outline" className="text-xs">stale</Badge>
                        ) : null}
                        </div>
                    </div>
                </AccordionTrigger>
              <AccordionContent>
                {folder.summary && (
                  <div className="mb-3 p-3 rounded bg-muted/50 text-sm">
                    <div className="text-xs font-semibold text-muted-foreground mb-1">FOLDER SUMMARY</div>
                    {folder.summary}
                  </div>
                )}
                <ul className="divide-y">
                {folder.files.filter((f) => f.supported).map((f) => (
                    <li key={f.file_id} className="py-2 flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{f.name}</div>
                        <div className="text-xs text-muted-foreground truncate flex gap-2 flex-wrap items-center">
                        <span>{f.mime_type.split("/").pop()?.split(".").pop()}</span>
                        {f.extracted && <Badge variant="outline" className="h-4 text-[10px]">extracted</Badge>}
                        {f.summarized && <Badge variant="outline" className="h-4 text-[10px]">summarized</Badge>}
                        {f.extract_error && (
                            <span className="text-destructive">⚠ {f.extract_error}</span>
                        )}
                        {f.truncated && <span className="text-amber-600">truncated</span>}
                        </div>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onRemoveFile(f.file_id)}
                        disabled={processing}
                    >
                        ×
                    </Button>
                    </li>
                ))}
                </ul>
                {folder.files.filter((f) => !f.supported).length > 0 && (
                <p className="text-xs text-muted-foreground mt-2 pl-2">
                    +{folder.files.filter((f) => !f.supported).length} unsupported file{folder.files.filter((f) => !f.supported).length === 1 ? "" : "s"} (see panel below)
                </p>
                )}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </div>
  )
}
