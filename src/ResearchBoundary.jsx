import React from "react";
// Keep the classic-view switch and the rest of company details usable if the
// optional chart bundle or a browser canvas fails.
export default class ResearchBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p role="alert">
        Chart and research tools could not load. Select “Use classic view” above
        to continue.
      </p>
    ) : (
      this.props.children
    );
  }
}
