import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent } from "@/components/ui/card"

type Exchange = {
  question: string
  answer: string
  pending: boolean
  error?: string
}

export function AskPanel() {
  const [question, setQuestion] = useState("")
  const [history, setHistory] = useState<Exchange[]>([])
  const [loading, setLoading] = useState(false)

  const presets = [
    "Summarize everything in my workspace",
    "What are the main themes across these folders?",
    "Which folder is most relevant to patent prosecution?",
    "List any open action items mentioned in these files",
  ]

  const ask = async (q: string) => {
    if (!q.trim()) return
    setLoading(true)
    setQuestion("")
    setHistory((h) => [...h, { question: q, answer: "", pending: true }])
    try {
      const r = await fetch("http://localhost:8000/api/chat/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      })
      const d = await r.json()
      setHistory((h) => {
        const copy = [...h]
        const last = copy[copy.length - 1]
        if (!r.ok) {
          last.error = d.error || `HTTP ${r.status}`
          last.pending = false
        } else {
          last.answer = d.answer
          last.pending = false
        }
        return copy
      })
    } catch (e) {
      setHistory((h) => {
        const copy = [...h]
        copy[copy.length - 1].error = e instanceof Error ? e.message : "Unknown"
        copy[copy.length - 1].pending = false
        return copy
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-3">
      {history.length === 0 && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Ask anything about your workspace. Gemma uses your folder and file summaries to answer.
          </p>
          <div className="flex flex-col gap-2">
            {presets.map((p) => (
                <Button
                key={p}
                variant="outline"
                size="sm"
                onClick={() => ask(p)}
                disabled={loading}
                className="justify-start text-left h-auto py-2 whitespace-normal"
                >
                {p}
                </Button>
            ))}
            </div>
        </div>
      )}

      <div className="space-y-3 max-h-[500px] overflow-y-auto">
        {history.map((ex, i) => (
          <div key={i} className="space-y-1.5">
            <Card>
              <CardContent className="pt-4 pb-3 text-sm font-medium">
                {ex.question}
              </CardContent>
            </Card>
            <Card className="ml-4">
              <CardContent className="pt-4 pb-3 text-sm whitespace-pre-wrap">
                {ex.pending ? (
                  <span className="text-muted-foreground italic">Thinking...</span>
                ) : ex.error ? (
                  <span className="text-destructive">Error: {ex.error}</span>
                ) : (
                  ex.answer
                )}
              </CardContent>
            </Card>
          </div>
        ))}
      </div>

      <div className="flex gap-2 pt-2 border-t">
        <Textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a question about your workspace..."
          rows={2}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              ask(question)
            }
          }}
        />
        <Button onClick={() => ask(question)} disabled={loading || !question.trim()}>
          Ask
        </Button>
      </div>
    </div>
  )
}
