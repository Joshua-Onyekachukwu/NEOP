import Link from "next/link";
import Image from "next/image";

export default function NotFound() {
  return (
    <>
      <div className="pt-[140px] md:pt-[160px] lg:pt-[220px] xl:pt-[260px] 2xl:pt-[280px] py-[70px] md:py-[90px] lg:py-[110px] xl:py-[150px] 2xl:py-[180px] bg-amber-50 dark:bg-[#0a0e19]">
        <div className="container sm:max-w-[540px] md:max-w-[720px] lg:max-w-[960px] xl:max-w-[1308px] mx-auto px-[12px]">
          <div className="text-center">
            <div className="mb-[30px]">
              <Image
                src="/images/not-found.png"
                alt="not-found"
                width={500}
                height={480}
                className="inline-block"
              />
            </div>

            <h2 className="mb-[15px]">Page Not Found</h2>
            <p>Could not find requested resource</p>

            <Link
              href="/"
              className="inline-block py-[9px] px-[25px] md:py-[10.5px] md:px-[30px] font-medium text-white bg-primary-500 rounded-[100px] border border-primary-500 transition-all hover:bg-primary-600 hover:border-primary-600 mx-[8px] mt-[15px] md:mt-0"
            >
              Return Home
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
