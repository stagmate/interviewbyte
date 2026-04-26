'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function RegisterPage() {
    const router = useRouter();
    
    useEffect(() => {
        router.push('/interview');
    }, [router]);

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <p>Redirecting to app...</p>
        </div>
    );
}
