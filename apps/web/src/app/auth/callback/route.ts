import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';
  const redirectTo = searchParams.get('redirect_to')?.toString();

  if (code) {
    // The auth code will be exchanged for a session by the Supabase client
    // We just need to redirect to the appropriate page
    if (redirectTo) {
      return NextResponse.redirect(`${origin}${redirectTo}`);
    }
    return NextResponse.redirect(`${origin}${next}`);
  }

  // Return the user to an error page with some instructions
  return NextResponse.redirect(`${origin}/auth/auth-code-error`);
}
