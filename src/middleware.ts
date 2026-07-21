import { NextResponse, type NextRequest } from "next/server";

const publicPrefixes = ["/login", "/api/auth/login", "/api/auth/logout"];

export function middleware(request: NextRequest) {
  const accessToken = process.env.DCH_ACCESS_TOKEN;
  if (!accessToken) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (publicPrefixes.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const cookieToken = request.cookies.get("dch_access")?.value;
  const headerToken = request.headers.get("x-dch-access-token");
  if (cookieToken === accessToken || headerToken === accessToken) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api")) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Adgang kræver login." } }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
