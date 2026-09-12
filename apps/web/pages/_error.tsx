import React from "react";

function Error({ statusCode }: { statusCode?: number }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 20px", fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: "24px", marginBottom: "8px" }}>{statusCode || "Error"}</h1>
      <p style={{ color: "#888" }}>
        {statusCode === 404
          ? "This page could not be found."
          : "An unexpected error occurred."}
      </p>
    </div>
  );
}

Error.getInitialProps = ({ res, err }: { res?: Record<string, unknown>; err?: Record<string, unknown> }) => {
  const statusCode = res ? (res.statusCode as number) : err ? (err.statusCode as number) : 404;
  return { statusCode };
};

export default Error;
