'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import Image from 'next/image';
import { Video, Users, Shield, Zap } from 'lucide-react';

export default function Home() {
  const router = useRouter();

  const handleGetStarted = useCallback(() => {
    const roomId = uuidv4();
    router.push(`/room/${roomId}`);
  }, [router]);

  const hacknixLogo = useMemo(() => ({
    src: '/logo.png',
    alt: 'Hacknix Logo',
    width: 120,
    height: 30,
  }), []);

  const features = [
    {
      icon: <Video className="w-6 h-6" />,
      title: "HD Video Calls",
      description: "Crystal clear video quality for professional meetings"
    },
    {
      icon: <Users className="w-6 h-6" />,
      title: "Team Collaboration",
      description: "Seamless collaboration tools for productive teamwork"
    },
    {
      icon: <Shield className="w-6 h-6" />,
      title: "Secure & Private",
      description: "End-to-end encryption keeps your meetings safe"
    },
    {
      icon: <Zap className="w-6 h-6" />,
      title: "Lightning Fast",
      description: "Optimized performance for smooth meeting experience"
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white overflow-hidden">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500/20 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500/20 rounded-full blur-3xl animate-pulse delay-1000"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl animate-pulse delay-500"></div>
      </div>

      {/* Main content */}
      <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-6 text-center">
        {/* Logo section with animation */}
        <div className="mb-12 transform hover:scale-105 transition-transform duration-300">
          <div className="p-4 bg-white/10 backdrop-blur-sm rounded-2xl border border-white/20">
            <Image {...hacknixLogo} className="brightness-0 invert" />
          </div>
        </div>

        {/* Hero section */}
        <div className="max-w-4xl mx-auto mb-16">
          <h1 className="text-6xl md:text-7xl font-bold mb-6 bg-gradient-to-r from-white via-purple-200 to-white bg-clip-text text-transparent leading-tight">
            Hacknix Meetings
          </h1>
          <div className="h-1 w-32 bg-gradient-to-r from-purple-500 to-blue-500 mx-auto mb-8 rounded-full"></div>
          <p className="text-xl md:text-2xl text-gray-300 mb-12 leading-relaxed max-w-3xl">
            Experience the future of online collaboration with our lightweight, secure, and lightning-fast meeting platform. 
            <span className="text-purple-300 font-medium"> Connect instantly</span> and 
            <span className="text-blue-300 font-medium"> collaborate seamlessly</span> with your team.
          </p>

          {/* CTA Button */}
          <button
            onClick={handleGetStarted}
            className="group relative px-12 py-5 bg-gradient-to-r from-purple-600 to-blue-600 rounded-2xl text-xl font-semibold hover:from-purple-500 hover:to-blue-500 transform hover:scale-105 hover:shadow-2xl hover:shadow-purple-500/25 transition-all duration-300"
          >
            <span className="relative z-10">Get Started Now</span>
            <div className="absolute inset-0 bg-gradient-to-r from-purple-400 to-blue-400 rounded-2xl blur opacity-0 group-hover:opacity-30 transition-opacity duration-300"></div>
          </button>
        </div>

        {/* Features grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
          {features.map((feature, index) => (
            <div 
              key={index}
              className="group p-6 bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 hover:bg-white/10 hover:border-white/20 transform hover:scale-105 hover:-translate-y-1 transition-all duration-300"
            >
              <div className="flex flex-col items-center text-center">
                <div className="p-3 bg-gradient-to-br from-purple-500/20 to-blue-500/20 rounded-xl mb-4 group-hover:from-purple-500/30 group-hover:to-blue-500/30 transition-all duration-300">
                  <div className="text-purple-300 group-hover:text-white transition-colors duration-300">
                    {feature.icon}
                  </div>
                </div>
                <h3 className="text-lg font-semibold mb-2 text-white group-hover:text-purple-200 transition-colors duration-300">
                  {feature.title}
                </h3>
                <p className="text-sm text-gray-400 group-hover:text-gray-300 transition-colors duration-300">
                  {feature.description}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Bottom accent */}
        <div className="mt-20 text-center">
          <div className="inline-block px-6 py-2 bg-white/5 backdrop-blur-sm rounded-full border border-white/10">
            <p className="text-sm text-gray-400">
              Trusted by teams worldwide • No downloads required
            </p>
          </div>
        </div>
      </div>

      {/* Static decorative elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-20 w-2 h-2 bg-white/10 rounded-full animate-pulse delay-1000"></div>
        <div className="absolute top-40 right-32 w-1 h-1 bg-purple-300/20 rounded-full animate-pulse delay-2000"></div>
        <div className="absolute bottom-32 left-40 w-1.5 h-1.5 bg-blue-300/15 rounded-full animate-pulse delay-500"></div>
        <div className="absolute bottom-20 right-20 w-1 h-1 bg-white/10 rounded-full animate-pulse delay-3000"></div>
        <div className="absolute top-1/2 left-10 w-1 h-1 bg-purple-400/20 rounded-full animate-pulse delay-1500"></div>
        <div className="absolute top-1/3 right-10 w-2 h-2 bg-blue-400/10 rounded-full animate-pulse delay-2500"></div>
      </div>
    </div>
  );
}