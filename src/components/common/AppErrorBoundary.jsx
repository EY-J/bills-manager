import React from "react";
import { captureRuntimeError } from "../../lib/monitoring/runtimeMonitor.js";

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    captureRuntimeError(error, {
      source: "react.error-boundary",
      componentStack: errorInfo?.componentStack || null,
    });
    console.error("App crashed in error boundary:", error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="app crashFallback" role="alert" aria-live="assertive">
          <div className="crashCard">
            <h1>Something went wrong</h1>
            <p className="muted">
              The app hit an unexpected error. Reload to recover safely.
            </p>
            <button type="button" className="btn primary" onClick={this.handleReload}>
              Reload app
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
