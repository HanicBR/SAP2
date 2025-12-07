
import React from 'react';
import { Icons } from './Icon';

interface PaginationProps {
  currentPage: number;
  totalItems: number;
  itemsPerPage: number;
  onPageChange: (page: number) => void;
}

export const Pagination: React.FC<PaginationProps> = ({ 
  currentPage, 
  totalItems, 
  itemsPerPage, 
  onPageChange 
}) => {
  const totalPages = Math.ceil(totalItems / itemsPerPage);

  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between px-4 py-3 bg-zinc-950/30 border-t border-zinc-800 rounded-b">
      <div className="flex flex-1 justify-between sm:hidden">
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="relative inline-flex items-center px-4 py-2 border border-zinc-700 text-sm font-medium rounded-md text-zinc-300 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50"
        >
          Anterior
        </button>
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="relative ml-3 inline-flex items-center px-4 py-2 border border-zinc-700 text-sm font-medium rounded-md text-zinc-300 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50"
        >
          Próximo
        </button>
      </div>
      
      <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-zinc-500">
            Mostrando <span className="font-bold text-white">{(currentPage - 1) * itemsPerPage + 1}</span> até <span className="font-bold text-white">{Math.min(currentPage * itemsPerPage, totalItems)}</span> de <span className="font-bold text-white">{totalItems}</span> resultados
          </p>
        </div>
        <div>
          <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
            <button
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-zinc-700 bg-zinc-900 text-sm font-medium text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="sr-only">Anterior</span>
              <Icons.List className="h-4 w-4 rotate-180 transform" /> {/* Using List icon rotated as chevron substitute or standard chevron if available, using text for clarity */}
              <span className="ml-1">Ant</span>
            </button>
            
            {/* Page Numbers */}
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                // Simple logic to show a window of pages or just first 5 for mock
                // In a real app, complex windowing (1 ... 4 5 6 ... 10) is better
                let pageNum = i + 1;
                if (totalPages > 5 && currentPage > 3) {
                    pageNum = currentPage - 2 + i;
                    if (pageNum > totalPages) pageNum = totalPages - (4 - i);
                }
                
                return (
                  <button
                    key={pageNum}
                    onClick={() => onPageChange(pageNum)}
                    className={`relative inline-flex items-center px-4 py-2 border text-sm font-bold ${
                      currentPage === pageNum
                        ? 'z-10 bg-red-900/20 border-red-900 text-red-500'
                        : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-white'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
            })}

            <button
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-zinc-700 bg-zinc-900 text-sm font-medium text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="sr-only">Próximo</span>
              <span className="mr-1">Prox</span>
              <Icons.List className="h-4 w-4" /> {/* Fallback icon or chevron */}
            </button>
          </nav>
        </div>
      </div>
    </div>
  );
};
