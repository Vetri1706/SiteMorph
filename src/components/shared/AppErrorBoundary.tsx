import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props { children: ReactNode }
interface State { error: Error | null }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[SiteMorph] render failed", { message: error.message, componentStack: info.componentStack });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="extension-shell">
        <div className="fatal-error" role="alert">
          <span><AlertTriangle size={22} /></span>
          <h1>SiteMorph couldn’t render</h1>
          <p>{this.state.error.message}</p>
          <button className="button button-primary" onClick={() => window.location.reload()}><RotateCcw size={15} />Reload extension</button>
        </div>
      </main>
    );
  }
}
